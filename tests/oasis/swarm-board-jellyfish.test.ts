import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateJellyfishRawFrame,
  renderColoredJellyfish,
  renderJellyfishMascot,
  colorJellyfishChar,
  squeeze,
  lift,
  rimAt,
  meta as jellyfishMeta,
} from '../../src/oasis/jellyfish-ascii';
import {
  createDefaultSwarmAgents,
  createDefaultSwarmPosts,
  renderSwarmBoard,
  formatRosterModelBadge,
  SwarmBoardState,
  SwarmAgent,
  SwarmPost,
  terminalCellWidth,
} from '../../src/oasis/swarm-board';
import { MaosTui } from '../../src/tui/maos-tui';

describe('MAOS Swarm Board & Jellyfish Mascot Suite', () => {
  // ── 1. Mathematical Jellyfish ASCII Simulation ────────────────────────────
  describe('Mathematical Jellyfish Generator', () => {
    it('produces exactly 26 rows and 44 columns as specified in meta', () => {
      const rawFrame = generateJellyfishRawFrame(0.5);
      const lines = rawFrame.split('\n');
      expect(lines).toHaveLength(jellyfishMeta.rows);
      for (const line of lines) {
        expect(line.length).toBe(jellyfishMeta.cols);
      }
    });

    it('simulates periodic squeeze bounded within [0, 1]', () => {
      for (let t = 0; t <= 5; t += 0.2) {
        const sq = squeeze(t);
        expect(sq).toBeGreaterThanOrEqual(0);
        expect(sq).toBeLessThanOrEqual(1);
      }
      // Periodicity check at t and t + 2.2
      const sq1 = squeeze(0.5);
      const sq2 = squeeze(0.5 + 2.2);
      expect(Math.abs(sq1 - sq2)).toBeLessThan(1e-5);
    });

    it('simulates lift motion bounded within [0, 1]', () => {
      for (let t = 0; t <= 5; t += 0.2) {
        const l = lift(t);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(1);
      }
    });

    it('calculates rim position and half diameter correctly', () => {
      const rim = rimAt(1.0, 44);
      expect(rim.x).toBeGreaterThan(15);
      expect(rim.x).toBeLessThan(30);
      expect(rim.y).toBeGreaterThan(5);
      expect(rim.y).toBeLessThan(15);
      expect(rim.half).toBeGreaterThan(5);
    });

    it("renders jellyfish characters including bell rim (~ ') and mouth frills (;)", () => {
      const rawFrame = generateJellyfishRawFrame(0.8);
      expect(rawFrame).toContain('~');
      expect(rawFrame).toContain("'");
      expect(rawFrame).toContain(';');
      expect(rawFrame).toContain(':');
    });

    it('colors jellyfish characters with MAOS Oasis cyberpunk palette', () => {
      const coloredBell = colorJellyfishChar('*', 5, 11);
      expect(coloredBell).toContain('\u001b['); // contains ANSI color code

      const coloredRim = colorJellyfishChar('~', 11, 11);
      expect(coloredRim).toContain('\u001b[');

      const coloredMouth = colorJellyfishChar(';', 15, 11);
      expect(coloredMouth).toContain('\u001b[');

      const coloredSpeck = colorJellyfishChar('·', 20, 11);
      expect(coloredSpeck).toContain('\u001b[');
    });

    it('generates colored jellyfish lines for full frame', () => {
      const coloredLines = renderColoredJellyfish(0.4);
      expect(coloredLines).toHaveLength(26);
      expect(coloredLines.some((l) => l.includes('\u001b['))).toBe(true);
    });

    it('renders compact 8-row mascot with pulsing bell and tentacles', () => {
      const mascot1 = renderJellyfishMascot(0.2);
      const mascot2 = renderJellyfishMascot(1.5);
      expect(mascot1).toHaveLength(8);
      expect(mascot2).toHaveLength(8);
      for (const line of mascot1) {
        expect(line.length).toBeGreaterThan(0);
        expect(terminalCellWidth(line)).toBe(20);
      }
      for (const line of mascot2) {
        expect(terminalCellWidth(line)).toBe(20);
      }
    });
  });

  // ── 2. Swarm Board Layout & Components ─────────────────────────────────────
  describe('MAOS Swarm Board Layout & Components', () => {
    let mockState: SwarmBoardState;

    beforeEach(() => {
      const goal = 'Build and deploy Canva 3D Spatial Studio';
      mockState = {
        goal,
        status: 'active',
        agents: createDefaultSwarmAgents(goal, 'gemma2:9b'),
        posts: createDefaultSwarmPosts(goal),
        selectedAgentIndex: 1, // Worker 1
        model: 'gemma2:9b',
        herdrConnected: true,
      };
    });

    it('initializes 5 default swarm agents including coordinator and 4 workers', () => {
      expect(mockState.agents).toHaveLength(5);
      expect(mockState.agents[0].id).toBe('coordinator');
      expect(mockState.agents[1].id).toBe('ignite-worker-1');
      expect(mockState.agents[2].id).toBe('ignite-worker-2');
      expect(mockState.agents[3].id).toBe('ignite-worker-3');
      expect(mockState.agents[4].id).toBe('ignite-worker-4');

      expect(mockState.agents[0].state).toBe('working');
      expect(mockState.agents[1].state).toBe('working');
      expect(mockState.agents[4].state).toBe('done');
    });

    it('initializes default live activity posts stream with tool calls and assignments', () => {
      expect(mockState.posts.length).toBeGreaterThanOrEqual(10);
      expect(mockState.posts[0].sender).toBe('coordinator');
      expect(mockState.posts[0].recipient).toBe('@ignite-worker-1');

      const toolPost = mockState.posts.find((p) => p.action === 'create_file');
      expect(toolPost).toBeDefined();
      expect(toolPost?.text).toContain('index.html');
    });

    it('renders header with Jellyfish mascot, Swarm board goal, and active agent count', () => {
      const renderedLines = renderSwarmBoard(mockState, { width: 90 });
      const fullText = renderedLines.join('\n');

      expect(fullText).toContain('Swarm board');
      expect(fullText).toContain('Canva 3D Spatial Studio');
      expect(fullText).toContain('agents');
      expect(fullText).toContain('active');
    });

    it('renders Roster column with all 5 swarm members and live states', () => {
      const renderedLines = renderSwarmBoard(mockState, { width: 90 });
      const fullText = renderedLines.join('\n');

      expect(fullText).toContain('ROSTER');
      expect(fullText).toContain('coordinator');
      expect(fullText).toContain('ignite-worker-1');
      expect(fullText).toContain('ignite-worker-2');
      expect(fullText).toContain('ignite-worker-3');
      expect(fullText).toContain('ignite-worker-4');
    });

    it('renders Posts column with live tool calls and messages', () => {
      const renderedLines = renderSwarmBoard(mockState, { width: 90 });
      const fullText = renderedLines.join('\n');

      expect(fullText).toContain('POSTS');
      expect(fullText).toContain('#1');
      expect(fullText).toContain('create_file:');
      expect(fullText).toContain('index.html');
    });

    it('renders Message / Detail Inspector with task details and git diff for selected agent', () => {
      const renderedLines = renderSwarmBoard(mockState, { width: 90 });
      const fullText = renderedLines.join('\n');

      expect(fullText).toContain('Inspector: ignite-worker-1');
      expect(fullText).toContain('HTML & 3D Spatial Viewport');
      expect(fullText).toContain('Task:');
      expect(fullText).toContain('Latest Tool:');
      expect(fullText).toContain('Diff:');
    });

    it('renders expanded inspector with Mathematical Moon Jellyfish frame when expanded=true', () => {
      mockState.expanded = true;
      const renderedLines = renderSwarmBoard(mockState, { width: 90 });
      const fullText = renderedLines.join('\n');

      expect(fullText).toContain('EXPANDED SWARM INSPECTOR');
      expect(fullText).toContain('MOON JELLYFISH SWARM KERNEL');
      expect(fullText).toContain('WORKTREE GIT DIFF / VERIFICATION TRACE');
      expect(fullText).toContain('diff --git a/index.html');
      expect(fullText).toContain('<!DOCTYPE html>');
    });

    it('formats model badges correctly preserving version and parameter count', () => {
      expect(formatRosterModelBadge('gemma2:9b')).toBe('GEMMA 9B');
      expect(formatRosterModelBadge('GEMMA 2 9B · LOCAL')).toBe('GEMMA 9B');
      expect(formatRosterModelBadge('gemma4:e2b')).toBe('GEMMA 4 2B');
      expect(formatRosterModelBadge('GEMMA 4 E2B · LOCAL')).toBe('GEMMA 4 2B');
      expect(formatRosterModelBadge('gemma2:2b')).toBe('GEMMA 2B');
      expect(formatRosterModelBadge('Qwen/Qwen2.5-3B-Instruct')).toBe('QWEN 3B');
      expect(formatRosterModelBadge('qwen2.5-coder:7b')).toBe('QWEN 7B');
    });

    it('renders distinct model badges in Roster column', () => {
      const renderedLines = renderSwarmBoard(mockState, { width: 90 });
      const fullText = renderedLines.join('\n');

      expect(fullText).toContain('[GEMMA 9B]');
      expect(fullText).toContain('[GEMMA 4 2B]');
      expect(fullText).toContain('[GEMMA 2B]');
    });

    it('strictly complies with terminal width without line overflows for various widths', () => {
      for (const w of [50, 60, 80, 100, 120]) {
        const normalLines = renderSwarmBoard(mockState, { width: w });
        for (const line of normalLines) {
          expect(terminalCellWidth(line)).toBeLessThanOrEqual(w);
        }

        const expLines = renderSwarmBoard({ ...mockState, expanded: true }, { width: w });
        for (const line of expLines) {
          expect(terminalCellWidth(line)).toBeLessThanOrEqual(w);
        }
      }
    });

    it('resiliently handles edge cases: empty agents, undefined posts, undefined goal', () => {
      const emptyState: SwarmBoardState = {
        goal: '',
        status: 'waiting',
        agents: [],
        posts: [],
        selectedAgentIndex: -1,
        model: 'gemma2:9b',
      };
      const lines = renderSwarmBoard(emptyState, { width: 80 });
      expect(lines.length).toBeGreaterThan(0);

      const nullState = {
        goal: undefined as any,
        status: 'done' as const,
        agents: null as any,
        posts: null as any,
        selectedAgentIndex: NaN,
        model: undefined as any,
      };
      const lines2 = renderSwarmBoard(nullState, { width: 80 });
      expect(lines2.length).toBeGreaterThan(0);
    });
  });

  // ── 3. MaosTui Tab 3 Integration & Key Interactions ────────────────────────
  describe('MaosTui Tab 3 Integration', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maos-swarm-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it('initializes MaosTui with swarmGoal, swarmAgents, and swarmPosts', () => {
      const tui = new MaosTui(tmpDir);
      expect(tui.getSwarmGoal()).toContain('Canva 3D Spatial Studio');
      expect(tui.getSwarmAgents()).toHaveLength(5);
      expect(tui.getSwarmPosts().length).toBeGreaterThan(0);
      expect(tui.getSelectedSwarmAgent().id).toBe('coordinator');
    });

    it('updates swarmGoal and resets agents and posts on setSwarmGoal', () => {
      const tui = new MaosTui(tmpDir);
      tui.setSwarmGoal('Build sovereign AI coding agent');
      expect(tui.getSwarmGoal()).toBe('Build sovereign AI coding agent');
      expect(tui.getSwarmAgents()[0].taskDesc).toContain('Build sovereign AI coding agent');
    });

    it('allows cycling and selecting swarm agents via setSelectedSwarmAgentIndex', () => {
      const tui = new MaosTui(tmpDir);
      tui.setSelectedSwarmAgentIndex(2);
      expect(tui.getSelectedSwarmAgent().id).toBe('ignite-worker-2');

      tui.setSelectedSwarmAgentIndex(4);
      expect(tui.getSelectedSwarmAgent().id).toBe('ignite-worker-4');
    });

    it('toggles swarm inspector expanded state via toggleSwarmInspectorExpanded', () => {
      const tui = new MaosTui(tmpDir);
      expect(tui.isSwarmInspectorExpanded()).toBe(false);
      expect(tui.toggleSwarmInspectorExpanded()).toBe(true);
      expect(tui.isSwarmInspectorExpanded()).toBe(true);
      expect(tui.toggleSwarmInspectorExpanded()).toBe(false);
      expect(tui.isSwarmInspectorExpanded()).toBe(false);
    });

    it('records live swarm tool operations dynamically via recordSwarmPost', () => {
      const tui = new MaosTui(tmpDir);
      const initialCount = tui.getSwarmPosts().length;

      tui.recordSwarmPost(
        'ignite-worker-1',
        '@coordinator',
        'create_file',
        'create_file: src/components/Studio.tsx (220 lines)',
      );

      const posts = tui.getSwarmPosts();
      expect(posts.length).toBe(initialCount + 1);
      const latest = posts[posts.length - 1];
      expect(latest.sender).toBe('ignite-worker-1');
      expect(latest.text).toContain('Studio.tsx');

      const worker1 = tui.getSwarmAgents().find((a) => a.id === 'ignite-worker-1');
      expect(worker1?.latestTool?.name).toBe('create_file');
      expect(worker1?.latestTool?.args).toContain('Studio.tsx');
    });

    it('renders Tab 3 cleanly without exceeding terminal cell widths', () => {
      const tui = new MaosTui(tmpDir);
      const lines: string[] = [];
      (tui as any).renderTabAgents(lines, 80, 24);

      expect(lines.length).toBeGreaterThan(0);
      const fullText = lines.join('\n');
      expect(fullText).toContain('Swarm board');
      expect(fullText).toContain('ROSTER');
      expect(fullText).toContain('POSTS');
      expect(fullText).toContain('Inspector:');

      // Verify no raw unescaped newlines inside lines
      for (const line of lines) {
        expect(line).not.toContain('\r');
      }
    });

    it('displays Tab 3 Swarm Board hotkeys: Tab switch view · P preview · Enter expand · R refresh · Esc back', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).activeTab = 3;

      const consoleSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        (tui as any).render();
        const callArgs = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(callArgs).toContain('Tab');
        expect(callArgs).toContain('Switch View');
        expect(callArgs).toContain('Preview');
        expect(callArgs).toContain('Expand');
        expect(callArgs).toContain('Refresh');
        expect(callArgs).toContain('Back');
      } finally {
        consoleSpy.mockRestore();
      }
    });
    it('ingests live ignite command stream: subtasks, worker spawn, tool calls, and green tests', () => {
      const tui = new MaosTui(tmpDir);
      const initialPosts = tui.getSwarmPosts().length;

      // Simulate decomposition
      (tui as any).appendCommandOutput('Decomposed into 4 subtasks (gemma2:9b)\n');
      // Simulate subtask assignment
      (tui as any).appendCommandOutput('  1/4  HTML & 3D Spatial Viewport\n');
      // Simulate worker spawning
      (tui as any).appendCommandOutput('Worker ignite-worker-1 live in w0:p1 (maos-ignite-0)\n');
      // Simulate tool call
      (tui as any).appendCommandOutput('[Tool Call] create_file: index.html for ignite-worker-1\n');
      // Simulate branch green / tests passed
      (tui as any).appendCommandOutput('Worker ignite-worker-1 Task marked complete, tests passed\n');

      const posts = tui.getSwarmPosts();
      expect(posts.length).toBeGreaterThan(initialPosts);

      const worker1 = tui.getSwarmAgents().find((a) => a.id === 'ignite-worker-1');
      expect(worker1).toBeDefined();
      expect(worker1?.state).toBe('done');
      expect(worker1?.paneId).toBe('w0:p1');
      expect(worker1?.branch).toBe('maos-ignite-0');
      expect(worker1?.gitDiff && worker1.gitDiff.length > 0).toBe(true);
    });

    it('intercepts mouse and terminal escape sequences without corrupting input boxes', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();

      // On Tab 1 (Mission Control / prompt input)
      (tui as any).activeTab = 1;
      (tui as any).modalInputText = '';

      // Simulate SGR mouse wheel up / down
      process.stdin.emit('keypress', '\x1b[<64;35;12M', { name: undefined, sequence: '\x1b[<64;35;12M' });
      process.stdin.emit('keypress', '\x1b[<65;35;12M', { name: undefined, sequence: '\x1b[<65;35;12M' });
      expect((tui as any).modalInputText).toBe('');

      // Simulate SGR mouse left click press and release
      process.stdin.emit('keypress', '\x1b[<0;20;10M', { name: undefined, sequence: '\x1b[<0;20;10M' });
      process.stdin.emit('keypress', '\x1b[<0;20;10m', { name: undefined, sequence: '\x1b[<0;20;10m' });
      expect((tui as any).modalInputText).toBe('');

      // Simulate SGR mouse drag / motion
      process.stdin.emit('keypress', '\x1b[<32;25;15M', { name: undefined, sequence: '\x1b[<32;25;15M' });
      expect((tui as any).modalInputText).toBe('');

      // Simulate X10 mouse tracking sequences
      process.stdin.emit('keypress', '\x1b[M\x60!!', { name: undefined, sequence: '\x1b[M\x60!!' });
      process.stdin.emit('keypress', '\x1b[M\x61!!', { name: undefined, sequence: '\x1b[M\x61!!' });
      process.stdin.emit('keypress', '\x1b[M !!', { name: undefined, sequence: '\x1b[M !!' });
      expect((tui as any).modalInputText).toBe('');

      // Simulate focus events and bracketed paste mode tags
      process.stdin.emit('keypress', '\x1b[I', { name: undefined, sequence: '\x1b[I' });
      process.stdin.emit('keypress', '\x1b[O', { name: undefined, sequence: '\x1b[O' });
      process.stdin.emit('keypress', '\x1b[200~', { name: undefined, sequence: '\x1b[200~' });
      process.stdin.emit('keypress', '\x1b[201~', { name: undefined, sequence: '\x1b[201~' });
      expect((tui as any).modalInputText).toBe('');

      // Verify that valid typed keys ARE accepted
      process.stdin.emit('keypress', 'a', { name: 'a', ctrl: false, meta: false });
      process.stdin.emit('keypress', 'b', { name: 'b', ctrl: false, meta: false });
      expect((tui as any).modalInputText).toBe('ab');

      // On Tab 2 (Dedicated Local Gemma Chat)
      (tui as any).activeTab = 2;
      (tui as any).chatInputText = '';

      process.stdin.emit('keypress', '\x1b[<0;10;5M', { name: undefined, sequence: '\x1b[<0;10;5M' });
      process.stdin.emit('keypress', '\x1b[<35;10;5m', { name: undefined, sequence: '\x1b[<35;10;5m' });
      expect((tui as any).chatInputText).toBe('');

      process.stdin.emit('keypress', 'h', { name: 'h', ctrl: false, meta: false });
      process.stdin.emit('keypress', 'i', { name: 'i', ctrl: false, meta: false });
      expect((tui as any).chatInputText).toBe('hi');

      (tui as any).cleanupKeyboard();
    });

    it('completely suppresses trackpad scrolling bursts and split escape chunks without leaking numbers into active inputs', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();

      // On Tab 1 (Dashboard / Prompt Input)
      (tui as any).activeTab = 1;
      (tui as any).modalInputText = '';

      // Simulate trackpad rapid scroll burst on raw stdin stream
      process.stdin.emit('data', '\x1b[<64;54;22M\x1b[<64;54;22M\x1b[<65;54;22M');
      expect((tui as any).modalInputText).toBe('');

      // Simulate mouse motion / drag coordinates
      process.stdin.emit('data', '\x1b[<32;70;35M\x1b[<35;70;35m');
      expect((tui as any).modalInputText).toBe('');

      // Simulate split chunks cut mid-sequence
      process.stdin.emit('data', '\x1b[<64;32;');
      process.stdin.emit('data', '15M');
      expect((tui as any).modalInputText).toBe('');

      // Simulate dangling coordinate sequence if header was severed
      process.stdin.emit('data', '32;70;35M');
      expect((tui as any).modalInputText).toBe('');

      // Normal typing with numbers and semicolons must pass through intact
      process.stdin.emit('data', 'deploy 3d studio; port 3030');
      expect((tui as any).modalInputText).toBe('deploy 3d studio; port 3030');

      // On Tab 2 (Dedicated Local Gemma Chat)
      (tui as any).activeTab = 2;
      (tui as any).chatInputText = '';

      // Trackpad scroll bursts on chat tab
      process.stdin.emit('data', '\x1b[<64;10;5M\x1b[<65;10;5M');
      expect((tui as any).chatInputText).toBe('');

      process.stdin.emit('data', 'tell me about 3D canvas');
      expect((tui as any).chatInputText).toBe('tell me about 3D canvas');

      (tui as any).cleanupKeyboard();
    });

    it('disables terminal mouse reporting modes on startup and exit', () => {
      const tui = new MaosTui(tmpDir);
      const written: string[] = [];
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
        written.push(String(data));
        return true;
      });

      // Spy on timer/loop methods to prevent infinite loop
      vi.spyOn(tui as any, 'startRefreshLoop').mockImplementation(() => {});
      vi.spyOn(tui as any, 'render').mockImplementation(() => {});

      try {
        tui.start();

        const combined = written.join('');
        // Must disable mouse reporting (1000l, 1002l, 1006l)
        expect(combined).toContain('\x1b[?1000l');
        expect(combined).toContain('\x1b[?1002l');
        expect(combined).toContain('\x1b[?1006l');

        // Must NOT enable mouse reporting (1000h, 1002h, 1006h)
        expect(combined).not.toContain('\x1b[?1000h');
        expect(combined).not.toContain('\x1b[?1002h');
        expect(combined).not.toContain('\x1b[?1006h');
      } finally {
        writeSpy.mockRestore();
        (tui as any).cleanupKeyboard();
        // Remove listeners attached by start()
        process.stdout.removeListener('resize', (tui as any).resizeHandler);
        process.removeListener('SIGINT', (tui as any).interruptHandler);
        process.removeListener('SIGTERM', (tui as any).terminateHandler);
      }
    });

    it('renders authentic mathematical moon jelly geometry with bell curve, wavy rim, and tentacles', () => {
      // Test across multiple stroke phases
      for (const t of [0.0, 0.4, 0.8, 1.2, 1.6, 2.0]) {
        const raw = generateJellyfishRawFrame(t, 44, 26);
        const lines = raw.split('\n');
        expect(lines).toHaveLength(26);

        // Every frame must contain wavy rim margin
        expect(raw).toMatch(/~|'/);
        // Every frame must contain tentacles or frills
        expect(raw).toMatch(/\||\/|\\|\(|\)/);
        expect(raw).toMatch(/;/);

        // Header mascot at this phase must be 8 rows of width 20 and recognizable
        const mascot = renderJellyfishMascot(t, 20, 8);
        expect(mascot).toHaveLength(8);
        for (const line of mascot) {
          expect(terminalCellWidth(line)).toBe(20);
        }
      }
    });
  });
});
