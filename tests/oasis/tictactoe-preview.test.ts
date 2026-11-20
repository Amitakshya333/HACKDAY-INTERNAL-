import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  exportBuiltArtifacts,
  disambiguateGoal,
  loadTaskHistory,
  saveTaskHistory,
  IgniteWorker,
} from '../../src/cli/commands/ignite';
import { generateCompactJellyfishRawFrame } from '../../src/oasis/jellyfish-ascii';
import { MaosTui } from '../../src/tui/maos-tui';
import { decompose } from '../../src/core/decomposer';

describe('⚡ Sovereign Swarm Tic-Tac-Toe & Context Continuity Suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maos-tictactoe-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Tic-Tac-Toe Core Engine Verification', () => {
    const { checkWinner, getAvailableMoves, minimax, WIN_COMBOS } = require('../fixtures/tictactoe-game.js');

    it('has all 8 standard winning combinations', () => {
      expect(WIN_COMBOS).toHaveLength(8);
      expect(WIN_COMBOS).toEqual([
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
      ]);
    });

    it('detects row win for Player X', () => {
      const board = ['X', 'X', 'X', 'O', 'O', '', '', '', ''];
      const result = checkWinner(board);
      expect(result).not.toBeNull();
      expect(result.winner).toBe('X');
      expect(result.combo).toEqual([0, 1, 2]);
    });

    it('detects column win for Player O', () => {
      const board = ['X', 'O', '', 'X', 'O', '', '', 'O', 'X'];
      const result = checkWinner(board);
      expect(result).not.toBeNull();
      expect(result.winner).toBe('O');
      expect(result.combo).toEqual([1, 4, 7]);
    });

    it('detects diagonal win for Player X', () => {
      const board = ['X', 'O', '', 'O', 'X', '', '', '', 'X'];
      const result = checkWinner(board);
      expect(result).not.toBeNull();
      expect(result.winner).toBe('X');
      expect(result.combo).toEqual([0, 4, 8]);
    });

    it('detects draw when board is completely filled with no line', () => {
      const board = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
      const result = checkWinner(board);
      expect(result).not.toBeNull();
      expect(result.winner).toBe('tie');
      expect(result.combo).toBeNull();
    });

    it('returns empty when match is still underway', () => {
      const board = ['X', '', '', '', 'O', '', '', '', ''];
      expect(checkWinner(board)).toBeNull();
    });

    it('reports all remaining available moves', () => {
      const board = ['X', 'O', 'X', '', '', '', '', '', ''];
      const moves = getAvailableMoves(board);
      expect(moves).toEqual([3, 4, 5, 6, 7, 8]);
    });

    it('Gemma AI Minimax awards highest score for instant winning move', () => {
      const board = ['O', 'O', '', 'X', 'X', '', '', '', ''];
      board[2] = 'O'; // Complete row 0 for O
      const score = minimax(board, 0, false);
      board[2] = '';
      expect(score).toBe(10);
    });
  });

  describe('Goal Disambiguation & Negation Intent Handling', () => {
    it('disambiguates "I told you to build a tic-tac-toe game not a Minecraft game"', () => {
      const disamb = disambiguateGoal('I told you to build a tic-tac-toe game not a Minecraft game');
      expect(disamb.isCorrection).toBe(true);
      expect(disamb.sanitizedGoal.toLowerCase()).toContain('tic-tac-toe game');
      expect(disamb.rejectedGoal?.toLowerCase()).toContain('minecraft game');
    });

    it('disambiguates "build me a tic tac toe game not minecraft"', () => {
      const disamb = disambiguateGoal('build me a tic tac toe game not minecraft');
      expect(disamb.isCorrection).toBe(true);
      expect(disamb.sanitizedGoal.toLowerCase()).toContain('tic tac toe game');
      expect(disamb.rejectedGoal?.toLowerCase()).toBe('minecraft');
    });

    it('disambiguates "you made me a minecraft game so make tic tac toe"', () => {
      const disamb = disambiguateGoal('you made me a minecraft game so make tic tac toe');
      expect(disamb.isCorrection).toBe(true);
      expect(disamb.sanitizedGoal.toLowerCase()).toContain('tic tac toe');
      expect(disamb.rejectedGoal?.toLowerCase()).toBe('minecraft game');
    });

    it('leaves clean goals without negation intact', () => {
      const disamb = disambiguateGoal('build me a tic tac toe game');
      expect(disamb.isCorrection).toBe(false);
      expect(disamb.sanitizedGoal).toBe('build me a tic tac toe game');
      expect(disamb.rejectedGoal).toBeUndefined();
    });
  });

  describe('Task History & Context Persistence', () => {
    it('persists and supersedes past goals on correction', () => {
      // 1. Initial run: Minecraft game
      saveTaskHistory(tmpDir, {
        timestamp: new Date().toISOString(),
        rawGoal: 'build me a minecraft game',
        sanitizedGoal: 'build me a minecraft game',
        subtasks: ['world gen', 'block placement'],
        status: 'active',
      });

      let history = loadTaskHistory(tmpDir);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('active');

      // 2. Correction run: Tic-tac-toe instead of Minecraft
      saveTaskHistory(tmpDir, {
        timestamp: new Date().toISOString(),
        rawGoal: 'I told you to build a tic-tac-toe game not a Minecraft game',
        sanitizedGoal: 'Build tic-tac-toe game',
        rejectedGoal: 'Minecraft game',
        subtasks: ['board UI', 'game engine', 'minimax AI'],
        status: 'active',
      });

      history = loadTaskHistory(tmpDir);
      expect(history).toHaveLength(2);
      expect(history[0].status).toBe('superseded');
      expect(history[1].status).toBe('active');
      expect(history[1].rejectedGoal).toBe('Minecraft game');
    });
  });

  describe('Artifact Clean Export & Stale File Purge', () => {
    it('purges old minecraft files and exports fresh tic-tac-toe files', () => {
      const outDir = path.join(tmpDir, 'output');
      const distDir = path.join(tmpDir, 'dist-preview');
      fs.mkdirSync(outDir, { recursive: true });
      fs.mkdirSync(distDir, { recursive: true });

      // Simulate leftover stale minecraft files from a previous run
      fs.writeFileSync(path.join(outDir, 'minecraft-world.js'), '// stale minecraft');
      fs.writeFileSync(path.join(distDir, 'minecraft-world.js'), '// stale minecraft');

      // Create mock worker worktree with tic-tac-toe files
      const wtDir = path.join(tmpDir, 'wt-worker-1');
      fs.mkdirSync(wtDir, { recursive: true });
      fs.writeFileSync(path.join(wtDir, 'index.html'), '<!DOCTYPE html><html><body>Tic Tac Toe</body></html>');
      fs.writeFileSync(path.join(wtDir, 'style.css'), 'body { background: #000; }');
      fs.writeFileSync(path.join(wtDir, 'game.js'), 'console.log("tic-tac-toe");');

      const workers: IgniteWorker[] = [
        {
          index: 0,
          title: 'Tic Tac Toe UI',
          agentId: 'Worker-1',
          branch: 'maos-ignite-0',
          worktreePath: wtDir,
          paneId: 'w0:p1',
          taskFile: path.join(tmpDir, 'Worker-1.md'),
        },
      ];

      const manifest = exportBuiltArtifacts(tmpDir, workers);

      // Verify old minecraft files were purged
      expect(fs.existsSync(path.join(outDir, 'minecraft-world.js'))).toBe(false);
      expect(fs.existsSync(path.join(distDir, 'minecraft-world.js'))).toBe(false);

      // Verify new tic-tac-toe files exist in output and dist-preview
      expect(fs.existsSync(path.join(outDir, 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'style.css'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'game.js'))).toBe(true);
      expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(true);

      // Verify manifest records
      expect(manifest.entrypointType).toBe('html');
      expect(manifest.entrypoint).toContain('index.html');
      expect(manifest.files.some((f) => f.path === 'index.html')).toBe(true);
    });

    it('strictly isolates repo apps and prevents apps/canva-3d from leaking into output', () => {
      const outDir = path.join(tmpDir, 'output');
      const distDir = path.join(tmpDir, 'dist-preview');
      const wtDir = path.join(tmpDir, 'wt-worker-leak-test');
      fs.mkdirSync(wtDir, { recursive: true });

      // Simulate a worktree that accidentally contains repo sources like apps/canva-3d
      fs.mkdirSync(path.join(wtDir, 'apps', 'canva-3d'), { recursive: true });
      fs.writeFileSync(path.join(wtDir, 'apps', 'canva-3d', 'index.html'), '<html>Minecraft Clone</html>');
      fs.writeFileSync(path.join(wtDir, 'apps', 'canva-3d', 'game.js'), '// voxel 3d');

      // The worker created valid game files at root
      fs.writeFileSync(path.join(wtDir, 'index.html'), '<html>Tic Tac Toe Real</html>');
      fs.writeFileSync(path.join(wtDir, 'game.js'), '// tictactoe');

      const workers: IgniteWorker[] = [
        {
          index: 0,
          title: 'Tic Tac Toe',
          agentId: 'Worker-1',
          branch: 'maos-ignite-0',
          worktreePath: wtDir,
          paneId: 'w0:p1',
          taskFile: path.join(tmpDir, 'Worker-1.md'),
        },
      ];

      const manifest = exportBuiltArtifacts(tmpDir, workers);

      // apps/canva-3d must NOT be copied into output or dist-preview
      expect(fs.existsSync(path.join(outDir, 'apps', 'canva-3d', 'index.html'))).toBe(false);
      expect(fs.existsSync(path.join(distDir, 'apps', 'canva-3d', 'index.html'))).toBe(false);

      // Root index.html must be the real tic-tac-toe, not the minecraft leak
      expect(fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8')).toContain('<html>Tic Tac Toe Real</html>');
      expect(manifest.entrypoint).toBe(path.join('output', 'index.html'));
      expect(manifest.files.some((f) => f.path.startsWith('apps/'))).toBe(false);
    });
  });

  describe('Decomposer Cross-Task Continuity & Negative Constraints', () => {
    it('passes negative correction constraints into decomposer prompt', async () => {
      let capturedSystemPrompt = '';
      let capturedUserPrompt = '';

      const mockProvider = {
        name: 'mock',
        model: 'mock',
        generate: async (messages: any[]) => {
          capturedSystemPrompt = messages.find((m) => m.role === 'system')?.content || '';
          capturedUserPrompt = messages.find((m) => m.role === 'user')?.content || '';
          return {
            content: JSON.stringify({
              tasks: [
                {
                  title: 'Build Tic Tac Toe UI',
                  description: 'Build HTML grid',
                  requiredCapabilities: ['frontend'],
                  complexity: 'low',
                  category: 'frontend',
                  dependsOn: [],
                  suggestedFiles: ['index.html'],
                },
              ],
              estimatedComplexity: 'low',
            }),
            toolCalls: [],
            finishReason: 'stop',
            latencyMs: 50,
            usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
          };
        },
      };

      await decompose(
        mockProvider as any,
        'Build a tic-tac-toe game',
        [{ id: 'worker-1', role: 'Frontend', capabilities: ['frontend'] }],
        tmpDir,
        {
          rejectedGoal: 'minecraft game',
          previousGoals: ['build me a minecraft game'],
          isCorrection: true,
        },
      );

      expect(capturedSystemPrompt).toContain('Session History & Task Continuity');
      expect(capturedSystemPrompt).toContain('CRITICAL USER CORRECTION (NEGATIVE CONSTRAINT)');
      expect(capturedSystemPrompt).toContain('minecraft game');
      expect(capturedUserPrompt).toContain('NOTE: The user explicitly rejected building "minecraft game"');
    });
  });

  describe('Mathematical Jellyfish Symmetrical Reflection', () => {
    function mirrorChar(ch: string): string {
      if (ch === '(') return ')';
      if (ch === ')') return '(';
      if (ch === '/') return '\\';
      if (ch === '\\') return '/';
      if (ch === '<') return '>';
      if (ch === '>') return '<';
      if (ch === '{') return '}';
      if (ch === '}') return '{';
      if (ch === '[') return ']';
      if (ch === ']') return '[';
      return ch;
    }

    it('guarantees 100% mathematical symmetry across all rows and all phases', () => {
      for (let t = 0; t <= 2.2; t += 0.2) {
        const frame = generateCompactJellyfishRawFrame(t, 20, 8);
        const rows = frame.split('\n');
        expect(rows).toHaveLength(8);
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          expect(row.length).toBe(20);
          for (let x = 0; x < 10; x++) {
            const leftChar = row[x];
            const rightChar = row[19 - x];
            expect(mirrorChar(leftChar)).toBe(rightChar);
          }
        }
      }
    });
  });

  describe('Ignite Live Vertical Scrolling and Mouse Reactivity', () => {
    it('scrolls transcript with up and down keys when externalCommandRunning is true', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      (tui as any).externalCommandRunning = true;
      (tui as any).activeTab = 1;
      (tui as any).transcriptViewportRows = 10;
      (tui as any).transcriptRenderedRowCount = 50;

      // Populate transcript
      for (let i = 0; i < 40; i++) {
        (tui as any).transcript.push(`Line ${i}: log output`);
      }

      expect((tui as any).transcriptScrollOffset).toBe(0);

      // Simulate keypress 'up'
      const keypressHandler = (tui as any).keypressHandler;
      keypressHandler(null, { name: 'up', ctrl: false, meta: false, shift: false });
      expect((tui as any).transcriptScrollOffset).toBeGreaterThan(0);

      const offsetAfterUp = (tui as any).transcriptScrollOffset;
      // Simulate keypress 'down'
      keypressHandler(null, { name: 'down', ctrl: false, meta: false, shift: false });
      expect((tui as any).transcriptScrollOffset).toBeLessThan(offsetAfterUp);

      // Simulate keypress 'home'
      keypressHandler(null, { name: 'home', ctrl: false, meta: false, shift: false });
      expect((tui as any).transcriptScrollOffset).toBeGreaterThan(0);
      expect((tui as any).transcriptScrollOffset).toBe(
        (tui as any).transcriptRenderedRowCount - (tui as any).transcriptViewportRows,
      );

      // Simulate keypress 'end'
      keypressHandler(null, { name: 'end', ctrl: false, meta: false, shift: false });
      expect((tui as any).transcriptScrollOffset).toBe(0);
    });

    it('interacts with mouse clicks on tabs 4 (Telemetry) and 5 (Event Log)', () => {
      const tui = new MaosTui(tmpDir);
      tui.setActiveTab(4);
      expect(tui.getActiveTab()).toBe(4);

      // Clicking telemetry top area
      const handledTel = tui.handleMouseClick(30, 4);
      expect(handledTel).toBe(true);

      tui.setActiveTab(5);
      expect(tui.getActiveTab()).toBe(5);

      // Clicking event log area
      const handledEv = tui.handleMouseClick(30, 10);
      expect(handledEv).toBe(true);
    });
  });
});
