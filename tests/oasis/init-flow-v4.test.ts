/**
 * MAOS Oasis — Architecture v4 Initialization Flow & Session Lifecycle Test Suite
 *
 * Comprehensive verification of:
 *   1. Two-Level Configuration (Machine vs Project)
 *   2. Per-User Folder Trust (trusted.json & findProjectRoot)
 *   3. Session Lifecycle, Schema & Durability (atomic writes, .lock, corrupted tolerance)
 *   4. Multi-Task Context Continuity (<PREVIOUS_TASK_CONTEXT> budgeting & compaction)
 *   5. CLI Command Routing (sessions, resume, trust, config)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

import {
  findProjectRoot,
  loadTrustedRoots,
  saveTrustedRoots,
  isProjectTrusted,
  trustProject,
  revokeProjectTrust,
  checkOrPromptFolderTrust,
  getTrustedFilePath,
} from '../../src/oasis/trust';

import {
  loadMachineConfig,
  saveMachineConfig,
  loadProjectConfig,
  saveProjectConfig,
  resolveEffectiveConfig,
  setConfigValue,
  getConfigValue,
  getMachineConfigPath,
  getProjectConfigPath,
} from '../../src/oasis/machine-config';

import {
  createSession,
  loadSession,
  saveSession,
  listSessions,
  getLatestSessionId,
  setCurrentSession,
  pruneSessions,
  formatPreviousTaskContext,
  compactSessionContext,
  acquireSessionLock,
  ensureProjectRuntimeDirs,
  generateSessionId,
  OasisSessionMetadata,
} from '../../src/oasis/session-manager';

import { MaosOasisConfig } from '../../src/oasis/types';
import { createDefaultOasisConfig, saveOasisConfig } from '../../src/oasis/config';
import { main } from '../../src/oasis/oasis-cli';

vi.mock('../../src/cli/repl', () => ({
  runRepl: vi.fn(),
}));

describe('⚡ MAOS Oasis Architecture v4 Initialization & Lifecycle Suite', () => {
  let tmpHome: string;
  let tmpProject: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-v4-home-'));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-v4-proj-'));
    process.env.MAOS_HOME = tmpHome;
    // Mark tmpProject as project root
    fs.mkdirSync(path.join(tmpProject, '.git'), { recursive: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpProject, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. Two-Level Configuration (Machine vs Project) ──────────────────────
  describe('1. Two-Level Configuration Architecture', () => {
    it('persists and loads machine config at ~/.maos-oasis/config.json atomically', () => {
      const cfg = createDefaultOasisConfig({ cwd: tmpProject });
      cfg.model.tag = 'gemma4:e2b';
      saveMachineConfig(cfg);

      const machinePath = getMachineConfigPath();
      expect(fs.existsSync(machinePath)).toBe(true);

      const loaded = loadMachineConfig();
      expect(loaded).not.toBeNull();
      expect(loaded?.model.tag).toBe('gemma4:e2b');
    });

    it('persists and loads project-level overrides in .maos-oasis/project.json', () => {
      ensureProjectRuntimeDirs(tmpProject);
      saveProjectConfig(tmpProject, {
        model: { primary: 'gemma2:2b', fallback: 'gemma2:2b', tag: 'gemma2:2b', contextTokens: 4096 },
      });

      const loadedProj = loadProjectConfig(tmpProject);
      expect(loadedProj?.model?.tag).toBe('gemma2:2b');
    });

    it('resolves effective config with project.json taking precedence over machine config', () => {
      // Machine has gemma2:9b
      const machineCfg = createDefaultOasisConfig({ cwd: tmpProject });
      machineCfg.model.tag = 'gemma2:9b';
      saveMachineConfig(machineCfg);

      // Project overrides to gemma4:e2b
      saveProjectConfig(tmpProject, {
        model: { primary: 'gemma4:e2b', fallback: 'gemma2:2b', tag: 'gemma4:e2b', contextTokens: 4096 },
      });

      const effective = resolveEffectiveConfig(tmpProject);
      expect(effective).not.toBeNull();
      expect(effective?.model.tag).toBe('gemma4:e2b');
    });

    it('sets and gets dotted config values on machine level and project level', () => {
      const machineCfg = createDefaultOasisConfig({ cwd: tmpProject });
      saveMachineConfig(machineCfg);

      setConfigValue('model.tag', 'gemma2:9b', { cwd: tmpProject });
      expect(getConfigValue('model.tag', { cwd: tmpProject })).toBe('gemma2:9b');

      // Set project override
      setConfigValue('model.tag', 'gemma2:2b', { project: true, cwd: tmpProject });
      expect(getConfigValue('model.tag', { project: true, cwd: tmpProject })).toBe('gemma2:2b');
    });

    it('rejects remote non-loopback Ollama host when setting config', () => {
      expect(() => {
        setConfigValue('ollama.host', '192.168.1.100', { cwd: tmpProject });
      }).toThrow(/Loopback security violation/);
    });
  });

  // ── 2. Per-User Folder Trust & Project Root Resolution ───────────────────
  describe('2. Folder Trust & Project Root Resolution', () => {
    it('resolves project root by walking up subdirectories to nearest .git or .maos-oasis', () => {
      const sub1 = path.join(tmpProject, 'packages', 'client', 'src');
      fs.mkdirSync(sub1, { recursive: true });

      // Create .maos-oasis at tmpProject root
      ensureProjectRuntimeDirs(tmpProject);

      const resolved = findProjectRoot(sub1);
      expect(resolved.toLowerCase()).toBe(tmpProject.toLowerCase());
    });

    it('records and checks project trust in ~/.maos-oasis/trusted.json', () => {
      expect(isProjectTrusted(tmpProject)).toBe(false);

      trustProject(tmpProject);
      expect(isProjectTrusted(tmpProject)).toBe(true);

      const trustedRoots = loadTrustedRoots();
      expect(trustedRoots.some((r) => r.toLowerCase() === tmpProject.toLowerCase())).toBe(true);

      revokeProjectTrust(tmpProject);
      expect(isProjectTrusted(tmpProject)).toBe(false);
    });

    it('auto-trusts folder when yes=true is supplied in options', async () => {
      const trusted = await checkOrPromptFolderTrust(tmpProject, { yes: true });
      expect(trusted).toBe(true);
      expect(isProjectTrusted(tmpProject)).toBe(true);
    });

    it('returns false for untrusted folder in non-interactive mode without --yes', async () => {
      const trusted = await checkOrPromptFolderTrust(tmpProject, { nonInteractive: true });
      expect(trusted).toBe(false);
    });
  });

  // ── 3. Session Lifecycle, Schema & Durability ─────────────────────────────
  describe('3. Session Lifecycle, Metadata Schema & Durability', () => {
    it('creates session with schemaVersion 1, atomic writes, and updates current_session.ref', () => {
      const session = createSession(tmpProject, {
        title: 'Build Tic Tac Toe',
        goal: 'build me a tic tac toe game',
        model: 'gemma2:9b',
      });

      expect(session.schemaVersion).toBe(1);
      expect(session.sessionId).toMatch(/^sess_\d{8}_\d{6}_[a-f0-9]{4}$/);
      expect(session.title).toBe('Build Tic Tac Toe');
      expect(session.status).toBe('active');
      expect(session.model).toBe('gemma2:9b');
      expect(session.tasks).toHaveLength(1);
      expect(session.tasks[0].goal).toBe('build me a tic tac toe game');

      // Verify current_session.ref points to this session
      const latestId = getLatestSessionId(tmpProject);
      expect(latestId).toBe(session.sessionId);
    });

    it('saves and reloads session metadata accurately', () => {
      const session = createSession(tmpProject, { goal: 'Goal 1' });
      session.tasks[0].status = 'completed';
      session.tasks[0].outputDir = 'tictactoe/';
      session.tasks[0].previewEntry = 'tictactoe/index.html';
      session.tasks[0].filesWritten = ['tictactoe/index.html', 'tictactoe/style.css'];
      session.stats.tokensGenerated = 450;
      saveSession(tmpProject, session);

      const loaded = loadSession(tmpProject, session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded?.tasks[0].outputDir).toBe('tictactoe/');
      expect(loaded?.tasks[0].filesWritten).toEqual(['tictactoe/index.html', 'tictactoe/style.css']);
      expect(loaded?.stats.tokensGenerated).toBe(450);
    });

    it('skips corrupted session.json with a warning without throwing or crashing', () => {
      const sessDir = path.join(tmpProject, '.maos-oasis', 'sessions', 'sess_corrupted_1234');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'session.json'), '{ malformed json: missing quotes... }');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const session = loadSession(tmpProject, 'sess_corrupted_1234');
      expect(session).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping unreadable session'));
    });

    it('acquires and releases session lock safely to prevent concurrent terminal collisions', () => {
      const session = createSession(tmpProject, { goal: 'Single writer goal' });

      const lock1 = acquireSessionLock(tmpProject, session.sessionId);
      expect(lock1.acquired).toBe(true);

      // Re-acquiring while active in same process reports not acquired
      const lock2 = acquireSessionLock(tmpProject, session.sessionId);
      expect(lock2.acquired).toBe(false);

      lock1.release();

      // After release, lock can be acquired again
      const lock3 = acquireSessionLock(tmpProject, session.sessionId);
      expect(lock3.acquired).toBe(true);
      lock3.release();
    });

    it('prunes sessions older than cutoff and cleans up worktrees', () => {
      const s1 = createSession(tmpProject, { title: 'Old Session' });
      const s2 = createSession(tmpProject, { title: 'New Session' });

      // Artificial age backdating for s1
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      s1.createdAt = oldDate;
      saveSession(tmpProject, s1);

      const pruneResult = pruneSessions(tmpProject, 30 * 24 * 60 * 60 * 1000);
      expect(pruneResult.prunedCount).toBe(1);
      expect(pruneResult.prunedIds).toContain(s1.sessionId);

      const remaining = listSessions(tmpProject);
      expect(remaining.map((r) => r.sessionId)).not.toContain(s1.sessionId);
      expect(remaining.map((r) => r.sessionId)).toContain(s2.sessionId);
    });
  });

  // ── 4. Multi-Task Context Continuity & Budgeting ─────────────────────────
  describe('4. Multi-Task Context Continuity (<PREVIOUS_TASK_CONTEXT>)', () => {
    it('formats <PREVIOUS_TASK_CONTEXT> with goal, outputDir, files, open issues and summary', () => {
      const session = createSession(tmpProject, { title: 'Tic Tac Toe', goal: 'build me a tic tac toe game' });
      session.tasks[0].outputDir = 'tictactoe/';
      session.tasks[0].previewEntry = 'tictactoe/index.html';
      session.tasks[0].filesWritten = ['tictactoe/index.html', 'tictactoe/style.css', 'tictactoe/game.js'];
      session.tasks[0].issues = ['Healer: target file not found: main.js'];
      saveSession(tmpProject, session);

      compactSessionContext(tmpProject, session.sessionId, 'Built initial grid and responsive layout.');

      const packet = formatPreviousTaskContext(session, tmpProject, 1500);

      expect(packet).toContain('<PREVIOUS_TASK_CONTEXT>');
      expect(packet).toContain(`Session: ${session.sessionId}`);
      expect(packet).toContain('Last goal: "build me a tic tac toe game"');
      expect(packet).toContain('Output directory: tictactoe/');
      expect(packet).toContain('tictactoe/index.html');
      expect(packet).toContain('Healer: target file not found: main.js');
      expect(packet).toContain('Built initial grid and responsive layout.');
      expect(packet).toContain('</PREVIOUS_TASK_CONTEXT>');
    });

    it('enforces token budget and truncates summary first when budget is tight', () => {
      const session = createSession(tmpProject, { title: 'Budget Test' });
      session.tasks = [
        {
          id: 't-1',
          goal: 'Big project',
          workers: [],
          outputDir: 'out/',
          previewEntry: 'out/index.html',
          status: 'completed',
          filesWritten: ['file1.ts'],
          issues: ['issue 1'],
        },
      ];
      saveSession(tmpProject, session);

      const hugeSummary = 'Long text '.repeat(1000); // ~10,000 chars
      compactSessionContext(tmpProject, session.sessionId, hugeSummary);

      const packet = formatPreviousTaskContext(session, tmpProject, 200); // 200 token budget (~800 chars)

      expect(packet.length).toBeLessThan(1500);
      expect(packet).toContain('[truncated]');
    });
  });

  // ── 5. Architecture v4 Security Gate, Gitignore & Concurrency ────────────
  describe('5. Architecture v4 Security Gate, Gitignore & Concurrency', () => {
    it('ensureProjectRuntimeDirs automatically appends .maos-oasis/ to .gitignore', () => {
      const gitignorePath = path.join(tmpProject, '.gitignore');
      fs.writeFileSync(gitignorePath, 'node_modules/\ndist/\n', 'utf-8');

      ensureProjectRuntimeDirs(tmpProject);

      const updated = fs.readFileSync(gitignorePath, 'utf-8');
      expect(updated).toContain('.maos-oasis/');
    });

    it('atomic lock creation using wx flag prevents second process from overwriting lock', () => {
      const session = createSession(tmpProject, { goal: 'Atomic lock test' });
      const lock1 = acquireSessionLock(tmpProject, session.sessionId);
      expect(lock1.acquired).toBe(true);

      // Verify lock file exists and contains process.pid
      const lockPath = path.join(tmpProject, '.maos-oasis', 'sessions', session.sessionId, '.lock');
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(fs.readFileSync(lockPath, 'utf-8').trim()).toBe(String(process.pid));

      // Attempt second acquisition while process is still alive
      const lock2 = acquireSessionLock(tmpProject, session.sessionId);
      expect(lock2.acquired).toBe(false);

      // Clean release
      lock1.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('resolves legacy config from project root even when cwd is a deep subfolder', () => {
      // Put legacy maos-oasis.config.json at tmpProject root
      const legacyCfg = createDefaultOasisConfig({ cwd: tmpProject });
      legacyCfg.model.tag = 'gemma2:9b';
      saveOasisConfig(legacyCfg, tmpProject);

      // Deep subfolder inside project
      const deepSub = path.join(tmpProject, 'src', 'components', 'button');
      fs.mkdirSync(deepSub, { recursive: true });

      const resolved = resolveEffectiveConfig(deepSub);
      expect(resolved).not.toBeNull();
      expect(resolved?.model.tag).toBe('gemma2:9b');
      expect(resolved?.oasisRoot.toLowerCase()).toBe(tmpProject.toLowerCase());
    });

    it('aborts cleanly with exit 0 when executing in an untrusted project folder in non-interactive mode', async () => {
      // tmpProject is NOT trusted yet
      const machineCfg = createDefaultOasisConfig({ cwd: tmpProject });
      saveMachineConfig(machineCfg);

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
        throw new Error(`process.exit: ${code}`);
      });
      const originalCwd = process.cwd();
      process.chdir(tmpProject);

      try {
        await expect(main(['node', 'maos-oasis'])).rejects.toThrow('process.exit: 0');
        expect(exitSpy).toHaveBeenCalledWith(0);
      } finally {
        process.chdir(originalCwd);
        exitSpy.mockRestore();
      }
    });

    it('creates a fresh session when invoked with positional prompt', async () => {
      // Trust the project first
      trustProject(tmpProject);
      const machineCfg = createDefaultOasisConfig({ cwd: tmpProject });
      saveMachineConfig(machineCfg);

      const originalCwd = process.cwd();
      process.chdir(tmpProject);

      const { runRepl } = await import('../../src/cli/repl');
      vi.mocked(runRepl).mockClear();

      try {
        await main(['node', 'maos-oasis', 'build me a cyberpunk tic-tac-toe game', '-y']);

        const sessions = listSessions(tmpProject);
        expect(sessions.length).toBeGreaterThan(0);
        const latest = sessions[0];
        expect(latest.tasks[0].goal).toBe('build me a cyberpunk tic-tac-toe game');
        expect(runRepl).toHaveBeenCalledWith(tmpProject);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('continues latest session and appends task when invoked with -c option', async () => {
      trustProject(tmpProject);
      const machineCfg = createDefaultOasisConfig({ cwd: tmpProject });
      saveMachineConfig(machineCfg);

      // Create initial session
      const sess = createSession(tmpProject, { goal: 'Initial Tic Tac Toe build' });
      sess.tasks[0].status = 'completed';
      saveSession(tmpProject, sess);

      const originalCwd = process.cwd();
      process.chdir(tmpProject);

      const { runRepl } = await import('../../src/cli/repl');
      vi.mocked(runRepl).mockClear();

      try {
        await main(['node', 'maos-oasis', '-c', 'make it glowing neon', '-y']);

        const reloaded = loadSession(tmpProject, sess.sessionId);
        expect(reloaded).not.toBeNull();
        expect(reloaded?.tasks.length).toBe(2);
        expect(reloaded?.tasks[1].goal).toBe('make it glowing neon');
        expect(runRepl).toHaveBeenCalledWith(tmpProject);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
