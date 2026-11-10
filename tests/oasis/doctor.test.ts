import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

const actualFs = vi.hoisted(() => {
  const realFs = require('fs');
  return { existsSync: realFs.existsSync.bind(realFs) };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p) => actual.existsSync(p)),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
    spawnSync: vi.fn(actual.spawnSync),
    spawn: vi.fn(actual.spawn),
  };
});

import {
  checkNodeVersion,
  checkConfigAndRuntime,
  checkLoopbackOpSec,
  checkOllamaDaemon,
  checkModelAndBenchmark,
  checkToolchains,
  findOllamaExecutable,
  findHerdrExecutable,
  attemptOllamaAutoStart,
  renderDoctorReport,
  runOasisDoctor,
  DEFAULT_LOOPBACK_HOST,
  DEFAULT_LOOPBACK_PORT,
  PROMPT_BENCHMARK_PAYLOAD,
} from '../../src/oasis/doctor';

import {
  saveOasisConfig,
  ensureOasisRuntimeDirs,
  getOasisConfigPath,
  getOasisRuntimeDir,
  OASIS_CURRENT_VERSION,
} from '../../src/oasis/config';

import { MaosOasisConfig, DoctorReport } from '../../src/oasis/types';

describe('Oasis Doctor Diagnostic Suite (tests/oasis/doctor.test.ts)', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-doctor-unit-'));
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.MISTRAL_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(fs.existsSync).mockImplementation(actualFs.existsSync);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createValidConfig(overrides: Partial<MaosOasisConfig> = {}): MaosOasisConfig {
    return {
      version: '1.0.0',
      oasisRoot: tmpDir,
      hardware: {
        gpu: 'NVIDIA GeForce RTX 4060 Laptop GPU',
        vramMB: 8188,
        tier: 'high',
      },
      model: {
        primary: 'gemma2:9b',
        fallback: 'gemma2:2b',
        tag: 'gemma2:9b',
        contextTokens: 8192,
      },
      ollama: {
        host: '127.0.0.1',
        port: 11434,
        autoStart: true,
      },
      dependencies: {
        herdr: { available: true, multiPaneEnabled: true },
        opencode: { available: true, harnessEnabled: true },
      },
      team: {
        preset: 'duo',
        leadModel: 'gemma2:9b',
        workerModel: 'gemma2:9b',
        reviewerModel: 'gemma2:9b',
      },
      ...overrides,
    };
  }

  // ── Diagnostic Check 1: Node.js Runtime Version ─────────────────────────
  describe('Check 1: Node.js Runtime Version (checkNodeVersion)', () => {
    it('passes when running on Node.js >= 20.0.0', () => {
      const result = checkNodeVersion();
      expect(result.id).toBe('node_version');
      expect(result.required).toBe(true);

      const major = parseInt(process.versions.node.split('.')[0], 10);
      if (major >= 20) {
        expect(result.status).toBe('pass');
        expect(result.message).toContain('Node >=20 satisfied');
      } else {
        expect(result.status).toBe('fail');
      }
    });

    it('fails with actionable update hint when simulated Node.js version is < 20', () => {
      const versionsSpy = vi.spyOn(process, 'versions', 'get').mockReturnValue({
        ...process.versions,
        node: '18.19.0',
      });

      const result = checkNodeVersion();
      expect(result.status).toBe('fail');
      expect(result.required).toBe(true);
      expect(result.message).toContain('v18.19.0 is unsupported');
      expect(result.fixHint).toContain('Update Node.js to version 20.0.0 or higher');

      versionsSpy.mockRestore();
    });
  });

  // ── Diagnostic Check 2: Config & Runtime Directories ────────────────────
  describe('Check 2: Configuration & Runtime Directory Integrity (checkConfigAndRuntime)', () => {
    it('fails when maos-oasis.config.json is missing in the target directory', () => {
      const result = checkConfigAndRuntime(tmpDir, false);
      expect(result.id).toBe('oasis_config');
      expect(result.status).toBe('fail');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Configuration missing');
      expect(result.fixHint).toContain('maos-oasis init');
    });

    it('fails when maos-oasis.config.json contains malformed JSON syntax', () => {
      const configPath = getOasisConfigPath(tmpDir);
      fs.writeFileSync(configPath, '{\n  "version": "1.0.0",\n  INVALID_JSON');

      const result = checkConfigAndRuntime(tmpDir, false);
      expect(result.status).toBe('fail');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Invalid configuration');
      expect(result.fixHint).toContain('Check syntax in maos-oasis.config.json');
    });

    it('warns when config exists but runtime subdirectories or .gitignore are missing (fix=false)', () => {
      const config = createValidConfig();
      saveOasisConfig(config, tmpDir);

      const result = checkConfigAndRuntime(tmpDir, false);
      expect(result.status).toBe('warn');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Runtime directory .maos-oasis missing');
      expect(result.fixHint).toContain('maos-oasis doctor --fix');
    });

    it('auto-repairs missing runtime subdirectories and hardened .gitignore when fix=true', () => {
      const config = createValidConfig();
      saveOasisConfig(config, tmpDir);

      // Verify directories do not exist yet
      const runtimeDir = getOasisRuntimeDir(tmpDir);
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'pending'))).toBe(false);

      const result = checkConfigAndRuntime(tmpDir, true);
      expect(result.status).toBe('pass');
      expect(result.message).toContain('auto-repaired');

      // Verify directories and .gitignore now exist
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'pending'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'active'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'done'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'failed'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'logs'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'status'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, '.gitignore'))).toBe(true);
    });

    it('passes when config and all runtime subdirectories and .gitignore are fully present', () => {
      const config = createValidConfig();
      saveOasisConfig(config, tmpDir);
      ensureOasisRuntimeDirs(tmpDir);

      const result = checkConfigAndRuntime(tmpDir, false);
      expect(result.status).toBe('pass');
      expect(result.required).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.metadata?.version).toBe('1.0.0');
    });
  });

  // ── Diagnostic Check 3: Sovereign Loopback OpSec Gate ───────────────────
  describe('Check 3: Sovereign Loopback OpSec Gate (checkLoopbackOpSec)', () => {
    it('passes and confirms sovereign loopback for standard 127.0.0.1 host', () => {
      const config = createValidConfig({ ollama: { host: '127.0.0.1', port: 11434, autoStart: true } });
      const result = checkLoopbackOpSec(config);

      expect(result.id).toBe('loopback_opsec');
      expect(result.status).toBe('pass');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Strict sovereign loopback confirmed');
      expect(result.message).toContain('Zero cloud transmission');
    });

    it('passes for localhost and IPv6 ::1 loopback addresses', () => {
      const configLocalhost = createValidConfig({ ollama: { host: 'localhost', port: 11434, autoStart: true } });
      expect(checkLoopbackOpSec(configLocalhost).status).toBe('pass');

      const configIpv6 = createValidConfig({ ollama: { host: '::1', port: 11434, autoStart: true } });
      expect(checkLoopbackOpSec(configIpv6).status).toBe('pass');
    });

    it('fails immediately when ollama.host is set to a non-loopback address', () => {
      const hostileHosts = ['192.168.1.100', '10.0.0.5', 'api.openai.com', 'evil.local'];

      for (const host of hostileHosts) {
        const config = createValidConfig({ ollama: { host, port: 11434, autoStart: true } });
        const result = checkLoopbackOpSec(config);

        expect(result.status).toBe('fail');
        expect(result.required).toBe(true);
        expect(result.message).toContain('OpSec Violation');
        expect(result.fixHint).toContain('Change "ollama.host" to "127.0.0.1"');
      }
    });

    it('audits cloud API keys in environment and confirms they are safely ignored', () => {
      process.env.OPENAI_API_KEY = 'mock';
      process.env.ANTHROPIC_API_KEY = 'mock';

      const config = createValidConfig();
      const result = checkLoopbackOpSec(config);

      expect(result.status).toBe('pass');
      expect(result.message).toContain('Cloud keys found in env (OPENAI_API_KEY, ANTHROPIC_API_KEY)');
      expect(result.message).toContain('ignored — sovereign local loopback strictly enforced');
    });
  });

  // ── Diagnostic Check 4: Ollama Daemon Reachability ──────────────────────
  describe('Check 4: Ollama Daemon Reachability (checkOllamaDaemon)', () => {
    it('passes and records latency when Ollama daemon responds with HTTP 200 on /api/tags', async () => {
      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }) as unknown as typeof globalThis.fetch;

      const { result, autoStarted, tagsData } = await checkOllamaDaemon('127.0.0.1', 11434, false, mockFetch);

      expect(result.id).toBe('ollama_daemon');
      expect(result.status).toBe('pass');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Online on 127.0.0.1:11434');
      expect(autoStarted).toBe(false);
      expect(tagsData).toEqual({ models: [{ name: 'gemma2:9b' }] });
    });

    it('fails with actionable fix hint when daemon is offline and fix=false', async () => {
      const mockFailingFetch = vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
      }) as unknown as typeof globalThis.fetch;

      const { result, autoStarted } = await checkOllamaDaemon('127.0.0.1', 11434, false, mockFailingFetch);

      expect(result.status).toBe('fail');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Ollama daemon is not responding on http://127.0.0.1:11434');
      expect(result.fixHint).toBeDefined();
      expect(autoStarted).toBe(false);
    });

    it('auto-starts daemon via child process when offline and fix=true succeeds', async () => {
      // Mock child_process spawn
      const spawnSpy = vi.spyOn(child_process, 'spawn').mockReturnValue({
        unref: vi.fn(),
      } as any);

      // Mock executable finder
      vi.spyOn(child_process, 'execSync').mockReturnValue(
        process.platform === 'win32' ? 'C:\\Program Files\\Ollama\\ollama.exe\n' : '/usr/bin/ollama\n',
      );
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      let callCount = 0;
      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        callCount++;
        // First ping fails, auto-start poll succeeds
        if (callCount <= 1) {
          throw new Error('Connection refused');
        }
        return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof globalThis.fetch;

      const { result, autoStarted } = await checkOllamaDaemon('127.0.0.1', 11434, true, mockFetch);

      expect(result.status).toBe('pass');
      expect(autoStarted).toBe(true);
      expect(result.message).toContain('(auto-started in background via --fix)');
      expect(spawnSpy).toHaveBeenCalled();
    });

    it('reports failure when daemon fails to auto-start within timeout on fix=true', async () => {
      vi.spyOn(child_process, 'spawn').mockReturnValue({ unref: vi.fn() } as any);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const mockAlwaysFailingFetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof globalThis.fetch;

      const autoStartOk = await attemptOllamaAutoStart(mockAlwaysFailingFetch, '127.0.0.1', 11434, 1200);
      expect(autoStartOk).toBe(false);
    });
  });

  // ── Diagnostic Check 5: Model Presence & Live Generation Speed Benchmark ─
  describe('Check 5: Model Presence & Live Generation Speed Benchmark (checkModelAndBenchmark)', () => {
    it('computes exact tokens/second and records benchmark metrics upon successful generation', async () => {
      const mockFetch = vi.fn(async (url: string | URL | Request, opts?: any) => {
        const body = JSON.parse(opts?.body || '{}');
        expect(body.model).toBe('gemma2:9b');
        expect(body.prompt).toBe(PROMPT_BENCHMARK_PAYLOAD);
        expect(body.stream).toBe(false);

        return new Response(
          JSON.stringify({
            response: 'OASIS_OK',
            eval_count: 40,
            eval_duration: 1_600_000_000, // 1.6s -> 40 / 1.6 = 25.0 tok/s
            prompt_eval_count: 12,
            prompt_eval_duration: 300_000_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof globalThis.fetch;

      const { result, benchmark } = await checkModelAndBenchmark(
        '127.0.0.1',
        11434,
        'gemma2:9b',
        { models: [{ name: 'gemma2:9b' }] },
        5000,
        mockFetch,
      );

      expect(result.id).toBe('model_benchmark');
      expect(result.status).toBe('pass');
      expect(result.required).toBe(true);
      expect(result.message).toContain('gemma2:9b verified live: 25 tok/s');

      expect(benchmark).toBeDefined();
      expect(benchmark?.tokensPerSecond).toBe(25.0);
      expect(benchmark?.evalCount).toBe(40);
      expect(benchmark?.evalDurationSec).toBe(1.6);
      expect(benchmark?.sampleOutput).toBe('OASIS_OK');
      expect(benchmark?.promptEvalCount).toBe(12);
    });

    it('matches model tags flexibly with or without :latest suffix', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 20, eval_duration: 1_000_000_000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof globalThis.fetch;

      // tagsData has gemma2:9b:latest, target is gemma2:9b
      const res1 = await checkModelAndBenchmark(
        '127.0.0.1',
        11434,
        'gemma2:9b',
        { models: [{ name: 'gemma2:9b:latest' }] },
        5000,
        mockFetch,
      );
      expect(res1.result.status).toBe('pass');

      // tagsData has gemma2:9b, target is gemma2:9b:latest
      const res2 = await checkModelAndBenchmark(
        '127.0.0.1',
        11434,
        'gemma2:9b:latest',
        { models: [{ name: 'gemma2:9b' }] },
        5000,
        mockFetch,
      );
      expect(res2.result.status).toBe('pass');
    });

    it('fails when target model is not downloaded in Ollama storage', async () => {
      const { result, benchmark } = await checkModelAndBenchmark(
        '127.0.0.1',
        11434,
        'gemma2:9b',
        { models: [{ name: 'gemma2:2b' }, { name: 'llama3:8b' }] },
        5000,
        vi.fn() as any,
      );

      expect(result.status).toBe('fail');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Configured model "gemma2:9b" is not downloaded in Ollama');
      expect(result.fixHint).toContain('ollama pull gemma2:9b');
      expect(benchmark).toBeUndefined();
    });

    it('fails when /api/generate returns non-200 HTTP error code', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response('CUDA out of memory in VRAM allocation', { status: 500 });
      }) as unknown as typeof globalThis.fetch;

      const { result } = await checkModelAndBenchmark(
        '127.0.0.1',
        11434,
        'gemma2:9b',
        { models: [{ name: 'gemma2:9b' }] },
        5000,
        mockFetch,
      );

      expect(result.status).toBe('fail');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Ollama generate API failed with HTTP 500');
      expect(result.fixHint).toContain('Ensure "gemma2:9b" is valid and your system has sufficient VRAM/RAM');
    });

    it('fails gracefully when generation times out or encounters network abort', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('The operation was aborted due to timeout.');
      }) as unknown as typeof globalThis.fetch;

      const { result } = await checkModelAndBenchmark(
        '127.0.0.1',
        11434,
        'gemma2:9b',
        { models: [{ name: 'gemma2:9b' }] },
        5000,
        mockFetch,
      );

      expect(result.status).toBe('fail');
      expect(result.required).toBe(true);
      expect(result.message).toContain('Live generation test timed out or failed');
      expect(result.fixHint).toContain('switching to lightweight "gemma2:2b"');
    });

    it('handles zero eval_duration defensively without Infinity or throwing', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            response: 'OASIS_OK',
            eval_count: 10,
            eval_duration: 0, // Zero duration edge case
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof globalThis.fetch;

      const { result, benchmark } = await checkModelAndBenchmark(
        '127.0.0.1',
        11434,
        'gemma2:9b',
        { models: [{ name: 'gemma2:9b' }] },
        5000,
        mockFetch,
      );

      expect(result.status).toBe('pass');
      expect(benchmark?.tokensPerSecond).toBeGreaterThan(0);
      expect(Number.isFinite(benchmark?.tokensPerSecond)).toBe(true);
    });
  });

  // ── Diagnostic Check 6: Companion Toolchain Integrations ─────────────────
  describe('Check 6: Companion Toolchain Integrations (checkToolchains)', () => {
    it('passes all 3 companion toolchain checks when herdr, opencode, and git worktrees are present', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('herdr --version')) return 'herdr 0.3.1\n';
        if (cmd.includes('opencode --version')) return 'opencode 1.0.4\n';
        if (cmd.includes('git rev-parse --is-inside-work-tree')) return 'true\n';
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return 'main\n';
        return '';
      });

      const results = checkToolchains(tmpDir);
      expect(results).toHaveLength(3);

      const [herdr, opencode, git] = results;

      expect(herdr.id).toBe('toolchain_herdr');
      expect(herdr.status).toBe('pass');
      expect(herdr.required).toBe(false);
      expect(herdr.message).toContain('Multi-pane terminal tiling enabled');

      expect(opencode.id).toBe('toolchain_opencode');
      expect(opencode.status).toBe('pass');
      expect(opencode.required).toBe(false);
      expect(opencode.message).toContain('AST/diff harness enabled');

      expect(git.id).toBe('git_repository');
      expect(git.status).toBe('pass');
      expect(git.required).toBe(false);
      expect(git.message).toContain('Worktree swarm isolation ready');
    });

    it('warns (required=false) when Herdr is missing and provides install command', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('herdr')) throw new Error('not found');
        if (cmd.includes('opencode --version')) return 'opencode 1.0.4\n';
        if (cmd.includes('git rev-parse --is-inside-work-tree')) return 'true\n';
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return 'main\n';
        return '';
      });

      const results = checkToolchains(tmpDir);
      const herdr = results.find((r) => r.id === 'toolchain_herdr');

      expect(herdr).toBeDefined();
      expect(herdr?.status).toBe('warn');
      expect(herdr?.required).toBe(false);
      expect(herdr?.message).toContain('Herdr not found — Single-pane terminal fallback active');
      expect(herdr?.fixHint).toContain('herdr.dev');
    });

    it('warns (required=false) when OpenCode is missing and provides npm install command', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('herdr --version')) return 'herdr 0.3.1\n';
        if (cmd.includes('opencode')) throw new Error('not found');
        if (cmd.includes('git rev-parse --is-inside-work-tree')) return 'true\n';
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return 'main\n';
        return '';
      });

      const results = checkToolchains(tmpDir);
      const opencode = results.find((r) => r.id === 'toolchain_opencode');

      expect(opencode).toBeDefined();
      expect(opencode?.status).toBe('warn');
      expect(opencode?.required).toBe(false);
      expect(opencode?.message).toContain('OpenCode not found — Direct loopback Ollama API fallback active');
      expect(opencode?.fixHint).toBe('npm install -g @opencode/cli');
    });

    it('warns (required=false) when directory is not inside a Git repository', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('herdr --version')) return 'herdr 0.3.1\n';
        if (cmd.includes('opencode --version')) return 'opencode 1.0.4\n';
        if (cmd.includes('git rev-parse')) throw new Error('fatal: not a git repository');
        return '';
      });

      const results = checkToolchains(tmpDir);
      const git = results.find((r) => r.id === 'git_repository');

      expect(git).toBeDefined();
      expect(git?.status).toBe('warn');
      expect(git?.required).toBe(false);
      expect(git?.message).toContain('Current directory is not a Git repository');
      expect(git?.fixHint).toContain('git init');
    });
  });

  // ── High-Level runOasisDoctor & Formatting ──────────────────────────────
  describe('High-Level Orchestration (runOasisDoctor)', () => {
    it('returns readiness "ready" and exitCode 0 when all 6 points pass', async () => {
      const config = createValidConfig();
      saveOasisConfig(config, tmpDir);
      ensureOasisRuntimeDirs(tmpDir);

      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('herdr --version')) return 'herdr 0.3.1\n';
        if (cmd.includes('opencode --version')) return 'opencode 1.0.4\n';
        if (cmd.includes('git rev-parse --is-inside-work-tree')) return 'true\n';
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return 'main\n';
        return '';
      });

      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 });
        }
        if (u.includes('/api/generate')) {
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 30, eval_duration: 1_000_000_000 }), {
            status: 200,
          });
        }
        return new Response('Not found', { status: 404 });
      }) as unknown as typeof globalThis.fetch;

      const report = await runOasisDoctor({
        cwd: tmpDir,
        fetch: mockFetch,
        silent: true,
      });

      expect(report.passed).toBe(true);
      expect(report.readiness).toBe('ready');
      expect(report.exitCode).toBe(0);
      expect(report.summary?.failed).toBe(0);
      expect(report.summary?.warned).toBe(0);
      expect(report.summary?.passed).toBe(8);
      expect(report.benchmark).toBeDefined();
    });

    it('returns readiness "ready_with_warnings" and exitCode 0 when optional toolchains warn', async () => {
      const config = createValidConfig();
      saveOasisConfig(config, tmpDir);
      ensureOasisRuntimeDirs(tmpDir);

      // Herdr and OpenCode absent
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('git rev-parse --is-inside-work-tree')) return 'true\n';
        if (cmd.includes('git rev-parse --abbrev-ref HEAD')) return 'main\n';
        throw new Error('command not found');
      });

      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 });
        }
        if (u.includes('/api/generate')) {
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 20, eval_duration: 1_000_000_000 }), {
            status: 200,
          });
        }
        return new Response('Not found', { status: 404 });
      }) as unknown as typeof globalThis.fetch;

      const report = await runOasisDoctor({
        cwd: tmpDir,
        fetch: mockFetch,
        silent: true,
      });

      expect(report.passed).toBe(true);
      expect(report.readiness).toBe('ready_with_warnings');
      expect(report.exitCode).toBe(0);
      expect(report.summary?.failed).toBe(0);
      expect(report.summary?.warned).toBeGreaterThanOrEqual(2);
    });

    it('returns readiness "not_ready" and exitCode 1 when a required check fails', async () => {
      // Missing config in tmpDir
      const mockFetch = vi.fn() as unknown as typeof globalThis.fetch;

      const report = await runOasisDoctor({
        cwd: tmpDir,
        fetch: mockFetch,
        silent: true,
      });

      expect(report.passed).toBe(false);
      expect(report.readiness).toBe('not_ready');
      expect(report.exitCode).toBe(1);
      expect(report.summary?.failed).toBeGreaterThanOrEqual(1);

      const configCheck = report.checks.find((c) => c.id === 'oasis_config');
      expect(configCheck?.status).toBe('fail');
    });

    it('supports --json flag and prints valid structured JSON report to console', async () => {
      const config = createValidConfig();
      saveOasisConfig(config, tmpDir);
      ensureOasisRuntimeDirs(tmpDir);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 10, eval_duration: 500_000_000 }), {
          status: 200,
        });
      }) as unknown as typeof globalThis.fetch;

      const report = await runOasisDoctor({
        cwd: tmpDir,
        fetch: mockFetch,
        json: true,
      });

      expect(logSpy).toHaveBeenCalled();
      const rawJson = logSpy.mock.calls[0][0];
      const parsed = JSON.parse(rawJson);
      expect(parsed.version).toBe(OASIS_CURRENT_VERSION);
      expect(parsed.readiness).toBe(report.readiness);
      expect(Array.isArray(parsed.checks)).toBe(true);
    });

    it('renders human-readable terminal output without throwing when silent is false', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const dummyReport: DoctorReport = {
        passed: true,
        readiness: 'ready',
        exitCode: 0,
        checks: [
          { id: 'node_version', name: 'Node.js Runtime', status: 'pass', required: true, message: 'v20.0.0 ok' },
          {
            id: 'toolchain_herdr',
            name: 'Herdr Toolchain',
            status: 'warn',
            required: false,
            message: 'Missing',
            fixHint: 'install herdr',
          },
          {
            id: 'ollama_daemon',
            name: 'Ollama Daemon',
            status: 'fail',
            required: true,
            message: 'Offline',
            fixHint: 'ollama serve',
          },
        ],
        summary: { total: 3, passed: 1, warned: 1, failed: 1 },
      };

      expect(() => renderDoctorReport(dummyReport)).not.toThrow();
      expect(logSpy).toHaveBeenCalled();
    });
  });
});
