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
    const { checkWinner, getAvailableMoves, minimax, WIN_COMBOS } = require('../../output/game.js');

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
  });
});
