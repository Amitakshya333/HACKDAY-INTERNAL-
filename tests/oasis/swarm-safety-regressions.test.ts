import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { execFileSync } from 'child_process';
import {
  findProtectedFileChanges,
  buildPreviousTaskContext,
  WORKER_GUARDRAILS,
  validateIgniteOptions,
  resolveAdaptiveSwarmPanes,
} from '../../src/cli/commands/ignite';
import { AutonomousHealer } from '../../src/core/autonomous-healer';
import { createSession, loadSession, saveSession } from '../../src/oasis/session-manager';
import { webgl3dScaffold, WEBGL_GOAL_PATTERN } from '../../src/cli/scaffolds/webgl3d';
import { injectPreviewErrorOverlay } from '../../src/tui/maos-tui';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf-8' }).trim();

describe('Swarm safety regressions', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maos-safety-'));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  });

  it('blocks merging a branch that rewrites an existing package.json, allows new files', () => {
    git(tmp, 'init', '-q');
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"maosorch"}');
    git(tmp, 'add', '.');
    git(tmp, 'commit', '-q', '-m', 'base');

    git(tmp, 'checkout', '-q', '-b', 'worker-bad');
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"localhost-3030"}');
    fs.writeFileSync(path.join(tmp, 'index.js'), 'require("express")');
    git(tmp, 'commit', '-q', '-am', 'npm init');
    git(tmp, 'add', '.');
    git(tmp, 'commit', '-q', '-m', 'server');

    git(tmp, 'checkout', '-q', '-');
    git(tmp, 'checkout', '-q', '-b', 'worker-ok');
    fs.writeFileSync(path.join(tmp, 'scene.js'), '// ok');
    git(tmp, 'add', '.');
    git(tmp, 'commit', '-q', '-m', 'scene');
    git(tmp, 'checkout', '-q', '-');

    expect(findProtectedFileChanges(tmp, 'worker-bad')).toEqual(['package.json']);
    expect(findProtectedFileChanges(tmp, 'worker-ok')).toEqual([]);
  });

  it('healer writes patches into the pane worktree, never the main project root', async () => {
    const root = path.join(tmp, 'root');
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(root);
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, 'script.js'), 'const g = new THREE.Geometry();\n');
    const healer = new AutonomousHealer({
      projectRoot: root,
      paneRoots: { 'pane-1': wt },
      paneIds: ['pane-1'],
      reader: {
        listPanes: async () => [{ paneId: 'pane-1' } as any],
        readBuffer: async () => 'TypeError: THREE.Geometry is not a constructor\n    at script.js:1:11\n',
      },
      provider: {
        generate: async () => ({
          content: JSON.stringify({
            diagnosis: 'Geometry removed in r125',
            ops: [{ type: 'replace-text', file: 'script.js', find: 'THREE.Geometry', content: 'THREE.BufferGeometry' }],
            confidence: 0.9,
          }),
        }),
      } as any,
      rerunTests: false,
    });
    const attempts = await healer.healOnce();
    expect(attempts.some((a) => a.applied)).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'script.js'), 'utf-8')).toContain('BufferGeometry');
    expect(fs.existsSync(path.join(root, 'script.js'))).toBe(false);
  });

  it('gives follow-up prompts the previous build files and explains localhost:3030', () => {
    expect(buildPreviousTaskContext(tmp)).toBeUndefined();
    const sess = createSession(tmp, { goal: 'build me a 3d triangle' });
    const loaded = loadSession(tmp, sess.sessionId)!;
    Object.assign(loaded.tasks[0], {
      outputDir: 'output',
      previewEntry: 'output/index.html',
      filesWritten: ['index.html', 'script.js'],
      status: 'completed',
    });
    loaded.tasks.push({ ...loaded.tasks[0], id: 'task-2', goal: 'localhost:3030 is blank, fix it', filesWritten: [] });
    saveSession(tmp, loaded);

    const ctx = buildPreviousTaskContext(tmp)!;
    expect(ctx).toContain('build me a 3d triangle');
    expect(ctx).toContain('script.js');
    expect(WORKER_GUARDRAILS).toContain('localhost:3030');
    expect(WORKER_GUARDRAILS).toContain('package.json');
    expect(WORKER_GUARDRAILS).toContain('BufferGeometry');
  });

  it('defaults to 2 worker panes to avoid saturating a single local GPU', () => {
    expect(validateIgniteOptions({ goal: 'x' } as any).panes).toBe(2);
    expect(validateIgniteOptions({ goal: 'x', panes: '4' } as any).panes).toBe(4);
  });

  it('3D fallback scaffold renders real WebGL geometry without a CDN or THREE.Geometry', () => {
    expect(WEBGL_GOAL_PATTERN.test('build me a 3d triangle')).toBe(true);
    expect(WEBGL_GOAL_PATTERN.test('create a snake game')).toBe(false);
    const files = webgl3dScaffold('build me a 3d triangle');
    const html = files.find((f) => f.path === 'index.html')!.content;
    const js = files.find((f) => f.path === 'scene.js')!.content;
    expect(html).toContain('<canvas');
    expect(html).not.toMatch(/https?:\/\//);
    expect(js).toContain("getContext('webgl')");
    expect(js).not.toContain('THREE.Geometry');

    const mod = { exports: {} as any };
    vm.runInNewContext(js, { module: mod, Math, Float32Array });
    const { perspective, modelView, TRIANGLE } = mod.exports;
    expect(TRIANGLE).toHaveLength(18);
    expect(perspective(Math.PI / 4, 1, 0.1, 100)).toHaveLength(16);
    expect(modelView(0, 0, 3)[14]).toBe(-3); // scene pushed in front of the camera
  });

  it('preview pages get an error overlay before any other script', () => {
    const html = injectPreviewErrorOverlay(
      '<html><head><title>t</title></head><body><script src="script.js"></script></body></html>',
    );
    expect(html.indexOf('maos-preview-error')).toBeGreaterThan(-1);
    expect(html.indexOf('maos-preview-error')).toBeLessThan(html.indexOf('script.js'));
    // Overlay script must be valid JS.
    const src = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    expect(() => new vm.Script(src)).not.toThrow();
  });

  it('dynamically adapts swarm panes based on task complexity and hardware tier', () => {
    // 1. Atomic / single-page tasks scale to 1 agent
    expect(resolveAdaptiveSwarmPanes(undefined, 'build me a 3d triangle', 4, 'high').panes).toBe(1);
    expect(resolveAdaptiveSwarmPanes(undefined, 'create a snake game', 4, 'high').panes).toBe(1);
    expect(resolveAdaptiveSwarmPanes(undefined, 'fix blank page', 4, 'high').panes).toBe(1);

    // 2. Component tasks scale to 2 agents
    expect(resolveAdaptiveSwarmPanes(undefined, 'markdown editor with live preview', 2, 'high').panes).toBe(2);

    // 3. Complex full-stack tasks scale up to hardware limit (3 on high, 4-6 on ultra, 1 on low)
    expect(
      resolveAdaptiveSwarmPanes(undefined, 'fullstack dashboard with sqlite backend and auth', 4, 'high').panes,
    ).toBe(3);
    expect(
      resolveAdaptiveSwarmPanes(undefined, 'fullstack dashboard with sqlite backend and auth', 4, 'ultra').panes,
    ).toBe(4);
    expect(
      resolveAdaptiveSwarmPanes(undefined, 'fullstack dashboard with sqlite backend and auth', 4, 'low').panes,
    ).toBe(1);

    // 4. Explicit user flag overrides automatic adaptation
    expect(resolveAdaptiveSwarmPanes('4', 'build me a 3d triangle', 1, 'low').panes).toBe(4);
  });
});
