import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Duplex } from 'stream';
import * as net from 'net';
import {
  HerdrHarness,
  splitPane,
  runCommand,
  readPaneBuffer,
  waitForOutput,
  listAgents,
  getAgent,
  sendPrompt,
  closePane,
  isHerdrAvailable,
  normalizeDirection,
  normalizeReadSource,
  resolveHerdrSocketPath,
  HerdrError,
  AgentInfo,
} from '../src/integrations/herdr';

/**
 * In-memory Mock Duplex Stream acting as a net.Socket
 */
class MockSocketStream extends Duplex {
  public written: string = '';
  public destroyed: boolean = false;

  constructor(private onWrite?: (data: string, socket: MockSocketStream) => void) {
    super();
  }

  _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const str = chunk.toString();
    this.written += str;
    if (this.onWrite) {
      this.onWrite(str, this);
    }
    callback();
  }

  _read(_size: number) {
    // no-op
  }

  destroy(error?: Error): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

describe('Herdr Harness - Multi-Pane Action Harness', () => {
  // ==========================================================================
  // 1. Parameter Normalization & Path Resolution
  // ==========================================================================
  describe('Helper & Normalization Functions', () => {
    it('normalizes directions correctly', () => {
      expect(normalizeDirection('right')).toBe('right');
      expect(normalizeDirection('vertical')).toBe('right');
      expect(normalizeDirection('down')).toBe('down');
      expect(normalizeDirection('horizontal')).toBe('down');
      expect(normalizeDirection(undefined)).toBe('right');
    });

    it('normalizes read sources correctly', () => {
      expect(normalizeReadSource('recent-unwrapped')).toEqual({
        socketSource: 'recent_unwrapped',
        cliSource: 'recent-unwrapped',
      });
      expect(normalizeReadSource('recent_unwrapped')).toEqual({
        socketSource: 'recent_unwrapped',
        cliSource: 'recent-unwrapped',
      });
      expect(normalizeReadSource('visible')).toEqual({
        socketSource: 'visible',
        cliSource: 'visible',
      });
      expect(normalizeReadSource('recent')).toEqual({
        socketSource: 'recent',
        cliSource: 'recent',
      });
      expect(normalizeReadSource('detection')).toEqual({
        socketSource: 'detection',
        cliSource: 'detection',
      });
      expect(normalizeReadSource(undefined)).toEqual({
        socketSource: 'recent_unwrapped',
        cliSource: 'recent-unwrapped',
      });
    });

    it('resolves socket paths with pipe prefix on Windows', () => {
      const resolved = resolveHerdrSocketPath('C:\\Users\\test\\herdr.sock');
      if (process.platform === 'win32') {
        expect(resolved).toBe('\\\\.\\pipe\\C:\\Users\\test\\herdr.sock');
      } else {
        expect(resolved).toBe('C:\\Users\\test\\herdr.sock');
      }
    });

    it('preserves already prefixed Windows named pipe paths', () => {
      const path = '\\\\.\\pipe\\custom_pipe';
      expect(resolveHerdrSocketPath(path)).toBe(path);
    });

    it('creates HerdrError with code and details', () => {
      const err = new HerdrError('Test error message', 'ERR_TEST', { foo: 'bar' });
      expect(err.message).toBe('Test error message');
      expect(err.code).toBe('ERR_TEST');
      expect(err.details).toEqual({ foo: 'bar' });
      expect(err.name).toBe('HerdrError');
    });
  });

  // ==========================================================================
  // 2. Transport & Socket Protocol Handling
  // ==========================================================================
  describe('Socket Transport Protocol', () => {
    it('sends JSON-RPC payload and parses response correctly', async () => {
      const mockConnector = async () => {
        const stream = new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          expect(req.method).toBe('agent.list');
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'agent_list',
                agents: [
                  {
                    pane_id: 'wA:p1',
                    agent: 'agy',
                    agent_status: 'idle',
                  },
                ],
              },
            }) + '\n',
          );
        });
        return stream as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const result = await harness.sendSocketRequest<any>('agent.list', {});
      expect(result.type).toBe('agent_list');
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].pane_id).toBe('wA:p1');
    });

    it('rejects on server error response', async () => {
      const mockConnector = async () => {
        const stream = new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          s.push(
            JSON.stringify({
              id: req.id,
              error: {
                code: 'pane_not_found',
                message: 'Pane wX:pY not found',
              },
            }) + '\n',
          );
        });
        return stream as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      await expect(harness.sendSocketRequest('pane.get', { pane_id: 'wX:pY' })).rejects.toThrow(/Pane wX:pY not found/);
    });

    it('handles socket timeout when server does not respond', async () => {
      const mockConnector = async () => {
        const stream = new MockSocketStream(() => {
          // Do not reply
        });
        return stream as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector, defaultTimeoutMs: 50 });
      await expect(harness.sendSocketRequest('ping', {}, 50)).rejects.toThrow(/timed out/);
    });

    it('assembles fragmented chunks over socket correctly', async () => {
      const mockConnector = async () => {
        const stream = new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          const fullResponse =
            JSON.stringify({
              id: req.id,
              result: {
                type: 'pane_read',
                text: 'A long fragmented message',
              },
            }) + '\n';

          // Emit in two fragments
          const half = Math.floor(fullResponse.length / 2);
          s.push(fullResponse.substring(0, half));
          setTimeout(() => {
            s.push(fullResponse.substring(half));
          }, 10);
        });
        return stream as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const result = await harness.sendSocketRequest<any>('pane.read', { pane_id: 'wA:p1' });
      expect(result.text).toBe('A long fragmented message');
    });
  });

  // ==========================================================================
  // 3. splitPane(direction, cwd, noFocus)
  // ==========================================================================
  describe('splitPane()', () => {
    it('creates new pane via socket with default arguments', async () => {
      let capturedParams: any = null;
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          capturedParams = req.params;
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'pane_info',
                pane: {
                  pane_id: 'wA:p2',
                  workspace_id: 'wA',
                  tab_id: 'wA:t1',
                  focused: false,
                },
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const paneId = await harness.splitPane();

      expect(paneId).toBe('wA:p2');
      expect(capturedParams).toEqual({
        direction: 'right',
        cwd: null,
        focus: false,
        target_pane_id: null,
      });
    });

    it('passes custom direction, cwd, and focus parameters', async () => {
      let capturedParams: any = null;
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          capturedParams = req.params;
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                pane: { pane_id: 'wA:p3' },
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const paneId = await harness.splitPane('horizontal', 'C:\\worktree', false);

      expect(paneId).toBe('wA:p3');
      expect(capturedParams).toEqual({
        direction: 'down',
        cwd: 'C:\\worktree',
        focus: true,
        target_pane_id: null,
      });
    });

    it('falls back to CLI when socket fails', async () => {
      const mockConnector = async () => {
        throw new Error('Socket unavailable');
      };

      let capturedArgs: string[] = [];
      const mockCli = async (_cmd: string, args: string[]) => {
        capturedArgs = args;
        return {
          stdout: JSON.stringify({
            id: 'cli:pane:split',
            result: {
              pane: { pane_id: 'wA:p4' },
            },
          }),
          stderr: '',
        };
      };

      const harness = new HerdrHarness({
        socketConnector: mockConnector,
        cliExecutor: mockCli,
      });

      const paneId = await harness.splitPane('down', 'C:\\test', true);
      expect(paneId).toBe('wA:p4');
      expect(capturedArgs).toContain('split');
      expect(capturedArgs).toContain('--direction');
      expect(capturedArgs).toContain('down');
      expect(capturedArgs).toContain('--cwd');
      expect(capturedArgs).toContain('C:\\test');
      expect(capturedArgs).toContain('--no-focus');
    });
  });

  // ==========================================================================
  // 4. runCommand(paneId, command)
  // ==========================================================================
  describe('runCommand()', () => {
    it('executes command via CLI pane run', async () => {
      let capturedArgs: string[] = [];
      const mockCli = async (_cmd: string, args: string[]) => {
        capturedArgs = args;
        return { stdout: '', stderr: '' };
      };

      const harness = new HerdrHarness({ cliExecutor: mockCli });
      await harness.runCommand('wA:p1', 'echo HELLO_MAOS');

      expect(capturedArgs).toEqual(['pane', 'run', 'wA:p1', 'echo HELLO_MAOS']);
    });

    it('falls back to socket send_input when CLI fails', async () => {
      const mockCli = async () => {
        throw new Error('CLI failed');
      };

      let capturedMethod = '';
      let capturedParams: any = null;
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          capturedMethod = req.method;
          capturedParams = req.params;
          s.push(JSON.stringify({ id: req.id, result: { type: 'ok' } }) + '\n');
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({
        cliExecutor: mockCli,
        socketConnector: mockConnector,
      });

      await harness.runCommand('wA:p2', 'git status');
      expect(capturedMethod).toBe('pane.send_input');
      expect(capturedParams).toEqual({
        pane_id: 'wA:p2',
        text: 'git status',
        keys: ['enter'],
      });
    });

    it('validates required arguments', async () => {
      const harness = new HerdrHarness();
      await expect(harness.runCommand('', 'echo 1')).rejects.toThrow(/paneId is required/);
      await expect(harness.runCommand('wA:p1', null as any)).rejects.toThrow(/command is required/);
    });
  });

  // ==========================================================================
  // 5. readPaneBuffer(paneId, lines, source)
  // ==========================================================================
  describe('readPaneBuffer()', () => {
    it('reads buffer via socket with default options', async () => {
      let capturedParams: any = null;
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          capturedParams = req.params;
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'pane_read',
                read: {
                  pane_id: 'wA:p1',
                  source: 'recent_unwrapped',
                  text: 'Line 1\nLine 2\nLine 3',
                },
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const buffer = await harness.readPaneBuffer('wA:p1');

      expect(buffer).toBe('Line 1\nLine 2\nLine 3');
      expect(capturedParams).toEqual({
        pane_id: 'wA:p1',
        source: 'recent_unwrapped',
        lines: 100,
        format: 'text',
        strip_ansi: true,
      });
    });

    it('reads buffer via CLI fallback', async () => {
      const mockConnector = async () => {
        throw new Error('Socket down');
      };

      let capturedArgs: string[] = [];
      const mockCli = async (_cmd: string, args: string[]) => {
        capturedArgs = args;
        return {
          stdout: 'Visible Output Terminal Content',
          stderr: '',
        };
      };

      const harness = new HerdrHarness({
        socketConnector: mockConnector,
        cliExecutor: mockCli,
      });

      const buffer = await harness.readPaneBuffer('wA:p2', 50, 'visible');
      expect(buffer).toBe('Visible Output Terminal Content');
      expect(capturedArgs).toEqual(['pane', 'read', 'wA:p2', '--source', 'visible', '--lines', '50']);
    });

    it('validates required paneId argument', async () => {
      const harness = new HerdrHarness();
      await expect(harness.readPaneBuffer('')).rejects.toThrow(/paneId is required/);
    });
  });

  // ==========================================================================
  // 6. waitForOutput(paneId, match, timeoutMs)
  // ==========================================================================
  describe('waitForOutput()', () => {
    it('waits for literal substring match via socket', async () => {
      let capturedParams: any = null;
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          capturedParams = req.params;
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'output_matched',
                pane_id: 'wA:p1',
                matched_line: 'Build completed successfully in 3.4s',
                read: { text: 'Compiling...\nBuild completed successfully in 3.4s' },
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const matched = await harness.waitForOutput('wA:p1', 'Build completed', 5000);

      expect(matched).toBe('Build completed successfully in 3.4s');
      expect(capturedParams.match).toEqual({
        type: 'substring',
        value: 'Build completed',
      });
    });

    it('waits for RegExp match via socket', async () => {
      let capturedParams: any = null;
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          capturedParams = req.params;
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'output_matched',
                pane_id: 'wA:p1',
                matched_line: 'Tests: 12 passed, 12 total',
                read: { text: 'Running...\nTests: 12 passed, 12 total' },
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const matched = await harness.waitForOutput('wA:p1', /Tests:\s+\d+\s+passed/, 5000);

      expect(matched).toBe('Tests: 12 passed, 12 total');
      expect(capturedParams.match).toEqual({
        type: 'regex',
        value: 'Tests:\\s+\\d+\\s+passed',
      });
    });

    it('polls buffer client-side when socket and CLI wait methods are unavailable', async () => {
      const mockConnector = async () => {
        throw new Error('Socket unsupported');
      };

      let readCallCount = 0;
      const mockCli = async (_cmd: string, args: string[]) => {
        if (args.includes('wait-output')) {
          throw new Error('wait-output not implemented');
        }
        if (args.includes('read')) {
          readCallCount++;
          if (readCallCount < 2) {
            return { stdout: 'Initializing tests...', stderr: '' };
          }
          return { stdout: 'Initializing tests...\nPASS: All test suites passed', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const harness = new HerdrHarness({
        socketConnector: mockConnector,
        cliExecutor: mockCli,
      });

      const result = await harness.waitForOutput('wA:p1', 'All test suites passed', 2000, {
        pollIntervalMs: 50,
      });

      expect(result).toContain('All test suites passed');
      expect(readCallCount).toBeGreaterThanOrEqual(2);
    });

    it('throws timeout error when pattern is never found', async () => {
      const mockConnector = async () => {
        throw new Error('No socket');
      };

      const mockCli = async (_cmd: string, args: string[]) => {
        if (args.includes('wait-output')) throw new Error('No wait-output');
        return { stdout: 'Still running...', stderr: '' };
      };

      const harness = new HerdrHarness({
        socketConnector: mockConnector,
        cliExecutor: mockCli,
      });

      await expect(harness.waitForOutput('wA:p1', 'NON_EXISTENT_MARKER', 200, { pollIntervalMs: 50 })).rejects.toThrow(
        /waitForOutput timed out/,
      );
    });

    it('validates required parameters for waitForOutput', async () => {
      const harness = new HerdrHarness();
      await expect(harness.waitForOutput('', 'marker')).rejects.toThrow(/paneId is required/);
      await expect(harness.waitForOutput('wA:p1', '')).rejects.toThrow(/match parameter is required/);
    });
  });

  // ==========================================================================
  // 7. listAgents() & getAgent(target)
  // ==========================================================================
  describe('listAgents() & getAgent()', () => {
    const mockAgents: AgentInfo[] = [
      {
        pane_id: 'wA:p1',
        agent: 'agy',
        agent_status: 'idle',
        cwd: 'C:\\HACKDAY WINNER',
      },
      {
        pane_id: 'wA:p6',
        agent: 'agy',
        agent_status: 'working',
        cwd: 'C:\\HACKDAY WINNER\\worktrees\\herdr-harness',
      },
      {
        pane_id: 'wA:p7',
        agent: 'opencode',
        agent_status: 'done',
        cwd: 'C:\\HACKDAY WINNER\\worktrees\\gemma-opencode',
      },
    ];

    it('lists agents via socket', async () => {
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'agent_list',
                agents: mockAgents,
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const agents = await harness.listAgents();

      expect(agents).toHaveLength(3);
      expect(agents[1].pane_id).toBe('wA:p6');
      expect(agents[1].agent_status).toBe('working');
      expect(agents[2].agent).toBe('opencode');
    });

    it('retrieves single agent by pane target', async () => {
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          expect(req.params.target).toBe('wA:p7');
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'agent_info',
                agent: mockAgents[2],
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const agent = await harness.getAgent('wA:p7');

      expect(agent).not.toBeNull();
      expect(agent?.agent).toBe('opencode');
      expect(agent?.agent_status).toBe('done');
    });

    it('returns null when agent is not found', async () => {
      const mockConnector = async () => {
        throw new Error('Socket fail');
      };

      const mockCli = async () => {
        throw new Error('agent not found');
      };

      const harness = new HerdrHarness({
        socketConnector: mockConnector,
        cliExecutor: mockCli,
      });

      const agent = await harness.getAgent('wA:p99');
      expect(agent).toBeNull();
    });

    it('validates target parameter for getAgent', async () => {
      const harness = new HerdrHarness();
      await expect(harness.getAgent('')).rejects.toThrow(/target is required/);
    });
  });

  // ==========================================================================
  // 8. sendPrompt(target, prompt, wait)
  // ==========================================================================
  describe('sendPrompt()', () => {
    it('sends prompt without wait via socket', async () => {
      let capturedParams: any = null;
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          capturedParams = req.params;
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'agent_prompted',
                agent: {
                  pane_id: 'wA:p6',
                  agent: 'agy',
                  agent_status: 'working',
                },
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const agent = await harness.sendPrompt('wA:p6', 'Start task 1');

      expect(agent.agent_status).toBe('working');
      expect(capturedParams).toEqual({
        target: 'wA:p6',
        text: 'Start task 1',
        wait: null,
      });
    });

    it('sends prompt with wait=true and receives settled state', async () => {
      let capturedParams: any = null;
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          capturedParams = req.params;
          s.push(
            JSON.stringify({
              id: req.id,
              result: {
                type: 'agent_prompted',
                agent: {
                  pane_id: 'reviewer',
                  agent: 'codex',
                  agent_status: 'done',
                },
              },
            }) + '\n',
          );
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const agent = await harness.sendPrompt('reviewer', 'Run audit', true, 60000);

      expect(agent.agent_status).toBe('done');
      expect(capturedParams).toEqual({
        target: 'reviewer',
        text: 'Run audit',
        wait: {
          timeout_ms: 60000,
          until: ['idle', 'done', 'blocked'],
        },
      });
    });

    it('falls back to CLI agent prompt --wait', async () => {
      const mockConnector = async () => {
        throw new Error('Socket fail');
      };

      let capturedArgs: string[] = [];
      const mockCli = async (_cmd: string, args: string[]) => {
        capturedArgs = args;
        return {
          stdout: JSON.stringify({
            result: {
              agent: {
                pane_id: 'wA:p7',
                agent: 'opencode',
                agent_status: 'idle',
              },
            },
          }),
          stderr: '',
        };
      };

      const harness = new HerdrHarness({
        socketConnector: mockConnector,
        cliExecutor: mockCli,
      });

      const agent = await harness.sendPrompt('wA:p7', 'Compile and verify', true, 45000);
      expect(agent.agent_status).toBe('idle');
      expect(capturedArgs).toContain('agent');
      expect(capturedArgs).toContain('prompt');
      expect(capturedArgs).toContain('wA:p7');
      expect(capturedArgs).toContain('Compile and verify');
      expect(capturedArgs).toContain('--wait');
      expect(capturedArgs).toContain('--timeout');
      expect(capturedArgs).toContain('45000');
    });

    it('validates required parameters for sendPrompt', async () => {
      const harness = new HerdrHarness();
      await expect(harness.sendPrompt('', 'prompt text')).rejects.toThrow(/target is required/);
      await expect(harness.sendPrompt('wA:p1', null as any)).rejects.toThrow(/prompt is required/);
    });
  });

  // ==========================================================================
  // 9. Utility Methods (closePane, isAvailable, listPanes)
  // ==========================================================================
  describe('Utilities & Top-Level Exports', () => {
    it('closes a pane cleanly via socket', async () => {
      let closedPane = '';
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          closedPane = req.params.pane_id;
          s.push(JSON.stringify({ id: req.id, result: { type: 'ok' } }) + '\n');
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      const ok = await harness.closePane('wA:p9');

      expect(ok).toBe(true);
      expect(closedPane).toBe('wA:p9');
    });

    it('checks multiplexer availability', async () => {
      const mockConnector = async () => {
        return new MockSocketStream((data, s) => {
          const req = JSON.parse(data.trim());
          s.push(JSON.stringify({ id: req.id, result: { agents: [] } }) + '\n');
        }) as unknown as net.Socket;
      };

      const harness = new HerdrHarness({ socketConnector: mockConnector });
      expect(await harness.isAvailable()).toBe(true);
    });

    it('standalone exported functions exist and are functions', () => {
      expect(typeof splitPane).toBe('function');
      expect(typeof runCommand).toBe('function');
      expect(typeof readPaneBuffer).toBe('function');
      expect(typeof waitForOutput).toBe('function');
      expect(typeof listAgents).toBe('function');
      expect(typeof getAgent).toBe('function');
      expect(typeof sendPrompt).toBe('function');
      expect(typeof closePane).toBe('function');
      expect(typeof isHerdrAvailable).toBe('function');
    });
  });

  // ==========================================================================
  // 10. Live Integration Smoke Test (Runs against real Herdr if active)
  // ==========================================================================
  describe('Live Herdr Integration Smoke Test', () => {
    it('queries live Herdr multiplexer non-destructively', async () => {
      const harness = new HerdrHarness();
      const available = await harness.isAvailable();

      if (available) {
        // Herdr multiplexer is running live on this host!
        const agents = await harness.listAgents();
        expect(Array.isArray(agents)).toBe(true);
        expect(agents.length).toBeGreaterThan(0);

        // Verify structure of first live agent
        const first = agents[0];
        expect(first.pane_id).toMatch(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+/);
        expect(first.agent_status).toBeDefined();

        // Query agent status by pane_id
        const fetched = await harness.getAgent(first.pane_id);
        expect(fetched).not.toBeNull();
        expect(fetched?.pane_id).toBe(first.pane_id);

        // Read a few lines of scrollback non-destructively
        const buffer = await harness.readPaneBuffer(first.pane_id, 3, 'recent-unwrapped');
        expect(typeof buffer).toBe('string');
      } else {
        // If Herdr is not running in CI, availability is cleanly false
        expect(available).toBe(false);
      }
    });
  });
});
