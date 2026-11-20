import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { execFileSync } from 'child_process';
import {
  exportBuiltArtifacts,
  recordBuildInSession,
  waitForWorkers,
  workerDoneMarker,
  IgniteWorker,
} from '../../src/cli/commands/ignite';
import { ensureWorktree } from '../../src/integrations/worktree';
import { createSession, loadSession } from '../../src/oasis/session-manager';
import { snakeScaffold, SNAKE_GOAL_PATTERN } from '../../src/cli/scaffolds/snake';
import { MaosTui } from '../../src/tui/maos-tui';

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf-8' }).trim();

describe('Stale preview & TUI regressions', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maos-stale-'));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  });

  function worker(over: Partial<IgniteWorker>): IgniteWorker {
    return {
      index: 0,
      title: 'w',
      agentId: 'Worker-1',
      branch: 'b',
      worktreePath: tmp,
      paneId: 'p1',
      taskFile: path.join(tmp, 'Worker-1.md'),
      ...over,
    };
  }

  it('exports only files the worker changed, never index.html inherited from HEAD', () => {
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(wt);
    git(wt, 'init', '-q');
    fs.writeFileSync(path.join(wt, 'index.html'), '<html>old tic-tac-toe</html>');
    git(wt, 'add', '.');
    git(wt, 'commit', '-q', '-m', 'old');
    const baseCommit = git(wt, 'rev-parse', 'HEAD');

    // Worker produced nothing: output must be empty, not the inherited game.
    const proj = path.join(tmp, 'proj');
    fs.mkdirSync(proj);
    let manifest = exportBuiltArtifacts(proj, [worker({ worktreePath: wt, baseCommit })]);
    expect(manifest.files).toEqual([]);
    expect(fs.existsSync(path.join(proj, 'output', 'index.html'))).toBe(false);

    // Worker rewrote index.html (committed) and added snake.js (uncommitted, modified-style status line).
    fs.writeFileSync(path.join(wt, 'index.html'), '<html>snake</html>');
    git(wt, 'commit', '-q', '-am', 'snake');
    fs.writeFileSync(path.join(wt, 'snake.js'), '// snake');
    manifest = exportBuiltArtifacts(proj, [worker({ worktreePath: wt, baseCommit })]);
    expect(manifest.files.map((f) => f.path).sort()).toEqual(['index.html', 'snake.js']);
    expect(fs.readFileSync(path.join(proj, 'output', 'index.html'), 'utf-8')).toBe('<html>snake</html>');
  });

  it('parses porcelain status lines whose first column is a space (" M file")', () => {
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(wt);
    git(wt, 'init', '-q');
    fs.writeFileSync(path.join(wt, 'app.js'), 'v1');
    git(wt, 'add', '.');
    git(wt, 'commit', '-q', '-m', 'v1');
    const baseCommit = git(wt, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(wt, 'app.js'), 'v2');
    const manifest = exportBuiltArtifacts(path.join(tmp, 'proj'), [worker({ worktreePath: wt, baseCommit })]);
    expect(manifest.files.map((f) => f.path)).toEqual(['app.js']);
  });

  it('waitForWorkers resolves once every done marker exists', async () => {
    const w = worker({});
    setTimeout(() => fs.writeFileSync(workerDoneMarker(w.taskFile), '0'), 50);
    const start = Date.now();
    await waitForWorkers([w], 5000, async () => ['p1'], 10);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('waitForWorkers resolves when the worker pane is gone, and gives up on timeout', async () => {
    await waitForWorkers([worker({})], 5000, async () => [], 10);
    const start = Date.now();
    await waitForWorkers([worker({})], 100, async () => ['p1'], 10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(90);
  });

  it('recordBuildInSession points the session task at the new build', () => {
    const sess = createSession(tmp, { goal: 'create a snake game' });
    recordBuildInSession(tmp, 'create a snake game', [worker({})], {
      timestamp: '',
      outputDir: 'output',
      distDir: 'dist-preview',
      files: [{ path: 'index.html', lines: 1, sizeBytes: 1, workerId: 'Worker-1' }],
      entrypoint: path.join('output', 'index.html'),
      entrypointType: 'html',
    });
    const task = loadSession(tmp, sess.sessionId)!.tasks[0];
    expect(task.outputDir).toBe('output');
    expect(task.previewEntry).toBe('output/index.html');
    expect(task.filesWritten).toEqual(['index.html']);
    expect(task.status).toBe('completed');
    expect(task.workers).toEqual(['Worker-1']);
  });

  it('ensureWorktree works in a freshly initialized repo with an unborn HEAD', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const info = ensureWorktree('Worker-1', 'maos-ignite-0', repo);
    expect(fs.existsSync(info.worktreePath)).toBe(true);
  });

  it('snake fallback scaffold is a playable game, not a stub', () => {
    expect(SNAKE_GOAL_PATTERN.test('create a snake game')).toBe(true);
    expect(SNAKE_GOAL_PATTERN.test('build tic tac toe')).toBe(false);
    const files = snakeScaffold();
    const html = files.find((f) => f.path === 'index.html')!.content;
    expect(html).toContain('<canvas');
    expect(html).toContain('snake.js');

    const mod = { exports: {} as any };
    vm.runInNewContext(files.find((f) => f.path === 'snake.js')!.content, { module: mod, Math });
    const { createState, step, turn } = mod.exports;
    const s = createState(() => 0);
    s.food = [11, 10];
    step(s);
    expect(s.score).toBe(1);
    expect(s.snake).toHaveLength(4);
    turn(s, 'left'); // reversing into itself is ignored
    expect(s.nextDir).toBe('right');
    for (let i = 0; i < 20 && !s.over; i++) step(s);
    expect(s.over).toBe(true); // ran into the wall
  });

  it('aligns all six sidebar labels on one column', () => {
    const tui = new MaosTui(tmp);
    tui.setSidebarCollapsed(false);
    (tui as any).lastRenderedFrame = [];
    (tui as any).renderInternal();
    const lines = ((tui as any).lastRenderedFrame as string[]).map((l) => l.replace(ANSI, ''));
    const cols = ['⌂  Dashboard', '✉  Chat', '❖  Swarm', '▥  Telemetry', '☰  Event Log', '⚙  Settings'].map(
      (label) => {
        const line = lines.find((l) => l.includes(label));
        expect(line, label).toBeDefined();
        return line!.indexOf(label);
      },
    );
    expect(new Set(cols).size).toBe(1);
  });

  it('keeps the brand visible while a task transcript is shown', () => {
    const tui = new MaosTui(tmp);
    (tui as any).activeTab = 1;
    (tui as any).transcript = ['$ Launching MAOS Gemma swarm', 'worker output'];
    (tui as any).lastRenderedFrame = [];
    (tui as any).renderInternal();
    const plain = ((tui as any).lastRenderedFrame as string[]).join('\n').replace(ANSI, '');
    expect(plain).toContain('worker output');
    expect(plain.includes('MAOS OASIS') || plain.includes('┌────────────┐')).toBe(true);
  });

  it('F3 toggles mouse capture so native text selection works', () => {
    const tui = new MaosTui(tmp);
    expect(tui.isMouseCaptureEnabled()).toBe(true);
    expect(tui.toggleMouseCapture()).toBe(false);
    expect(tui.toggleMouseCapture()).toBe(true);
  });
});
