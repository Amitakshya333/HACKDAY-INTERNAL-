/**
 * Antigravity Swarm Board for MAOS Oasis (Tab 3)
 *
 * Implements the Antigravity Swarm Board layout:
 * - Animated Jellyfish Mascot ASCII Art (Cyberpunk palette: violet, cyan, emerald, slate)
 * - Header: Jellyfish mascot alongside `Swarm board "<Current Goal>"` · N agents · [active]
 * - Roster: List of swarm members (`coordinator`, `ignite-worker-1` .. `ignite-worker-4`)
 *   with live state (`● working`, `○ waiting`, `✓ done`) and model badge (`GEMMA 9B`, `GEMMA 4 2B`, etc.)
 * - Posts / Live Activity Stream: Live feed showing agent tool calls and messages
 *   (e.g. `> #1 coordinator @worker-1 You own the implementation...`, `> #2 worker-1 @coordinator create_file: script.js`)
 * - Message / Detail Inspector: Box showing selected agent's current task details, latest tool call result, and git diff
 * - Clean Hotkey Footer: `tab switch view · p preview · enter expand · r refresh · esc back`
 */

import chalk from 'chalk';
import {
  renderJellyfishMascot,
  renderColoredJellyfish,
  generateJellyfishRawFrame,
  squeeze,
  lift,
} from './jellyfish-ascii';
import { formatHeaderBadge } from './model-detector';

const ANSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function terminalCellWidth(value: string | undefined | null): number {
  if (value == null) return 0;
  const str = String(value);
  let width = 0;
  const plainText = str.replace(ANSI_SEQUENCE, '').replace(/[\r\n]+/g, '');
  for (const { segment } of GRAPHEME_SEGMENTER.segment(plainText)) {
    const points = Array.from(segment, (char) => char.codePointAt(0) || 0);
    const point = points.find((v) => v !== 0x200d && !(v >= 0xfe00 && v <= 0xfe0f)) || 0;
    const wide =
      point >= 0x1100 &&
      (point <= 0x115f ||
        point === 0x2329 ||
        point === 0x232a ||
        (point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f) ||
        (point >= 0xac00 && point <= 0xd7a3) ||
        (point >= 0xf900 && point <= 0xfaff) ||
        (point >= 0xfe10 && point <= 0xfe19) ||
        (point >= 0xfe30 && point <= 0xfe6f) ||
        (point >= 0xff00 && point <= 0xff60) ||
        (point >= 0xffe0 && point <= 0xffe6) ||
        (point >= 0x1f300 && point <= 0x1faff) ||
        (point >= 0x20000 && point <= 0x3fffd));
    const emojiPresentation =
      points.includes(0xfe0f) ||
      points.includes(0x20e3) ||
      points.filter((v) => v >= 0x1f1e6 && v <= 0x1f1ff).length === 2 ||
      points.some(
        (v) =>
          (v >= 0x1f000 && v <= 0x1faff) ||
          (v >= 0x2700 && v <= 0x27bf) || // Dingbats (❌ 0x274c, ✅ 0x2705, etc.)
          (v >= 0x2600 && v <= 0x26ff && [0x26a0, 0x26a1, 0x26d4, 0x267f, 0x2699].includes(v)),
      );
    width += wide || emojiPresentation ? 2 : 1;
  }
  return width;
}

export function fitTerminalLine(value: string | undefined | null, width: number): string {
  if (width <= 0) return '';
  const str = value == null ? '' : String(value);
  const cleanValue = str.replace(/[\r\n]+/g, ' ');
  const fullWidth = terminalCellWidth(cleanValue);
  const clipped = fullWidth > width;
  const limit = clipped ? Math.max(0, width - 1) : width;
  let used = 0;
  let output = '';
  const tokens = cleanValue.match(/\u001b\[[0-?]*[ -/]*[@-~]|[^\u001b]+|\u001b/gu) || [];

  segments: for (const token of tokens) {
    if (token.startsWith('\u001b')) {
      output += token;
      continue;
    }
    for (const { segment } of GRAPHEME_SEGMENTER.segment(token)) {
      const cells = terminalCellWidth(segment);
      if (used + cells > limit) break segments;
      output += segment;
      used += cells;
    }
  }

  if (clipped) {
    if (used < width) {
      output += '…';
      used += 1;
    }
  }
  if (cleanValue.includes('\u001b')) output += '\u001b[0m';
  return output + ' '.repeat(Math.max(0, width - used));
}

export function centerTerminalLine(value: string | undefined | null, width: number): string {
  if (value == null) return ' '.repeat(Math.max(0, width));
  const cleanValue = String(value).replace(/[\r\n]+/g, ' ');
  const valueWidth = terminalCellWidth(cleanValue);
  if (valueWidth >= width) return fitTerminalLine(cleanValue, width);
  const left = Math.floor((width - valueWidth) / 2);
  const reset = cleanValue.includes('\u001b') ? '\u001b[0m' : '';
  return ' '.repeat(left) + cleanValue + reset + ' '.repeat(Math.max(0, width - valueWidth - left));
}

// ── Palette ──────────────────────────────────────────────────────────
const colorInstance = new chalk.Instance({ level: 3 });

export const swarmColors = {
  violet: colorInstance.hex('#8B5CF6'),
  violetBright: colorInstance.hex('#A78BFA'),
  pink: colorInstance.hex('#EC4899'),
  cyan: colorInstance.hex('#06B6D4'),
  cyanBright: colorInstance.hex('#38BDF8'),
  emerald: colorInstance.hex('#10B981'),
  amber: colorInstance.hex('#F59E0B'),
  slateDark: colorInstance.hex('#0F172A'),
  slateCard: colorInstance.hex('#1E293B'),
  slateBorder: colorInstance.hex('#334155'),
  slateMuted: colorInstance.hex('#64748B'),
  slateText: colorInstance.hex('#94A3B8'),
  white: colorInstance.hex('#F8FAFC'),
  boldWhite: colorInstance.bold.hex('#FFFFFF'),
};

const c = swarmColors;

// ── Interfaces ───────────────────────────────────────────────────────
export interface SwarmAgent {
  id: string; // 'coordinator', 'ignite-worker-1', ...
  name: string; // 'Coordinator', 'Worker 1', ...
  role: string; // 'Swarm Lead', '3D Scene Viewport', ...
  state: 'working' | 'waiting' | 'done';
  model: string; // 'GEMMA 9B', 'GEMMA 4 2B', etc.
  branch: string; // 'main', 'maos-ignite-0', ...
  paneId?: string; // 'w0:p1'
  taskTitle: string;
  taskDesc: string;
  latestTool?: {
    name: string;
    args: string;
    result: string;
    time: string;
  };
  gitDiff?: string[];
}

export interface SwarmPost {
  id: number;
  sender: string;
  recipient: string;
  action: string;
  text: string;
  time: string;
  type?: 'tool' | 'message' | 'status' | 'system';
}

export interface SwarmBoardState {
  goal: string;
  status: 'active' | 'waiting' | 'done';
  agents: SwarmAgent[];
  posts: SwarmPost[];
  selectedAgentIndex: number;
  expanded?: boolean;
  model: string;
  herdrConnected?: boolean;
}

/**
 * Formats model strings into clean, concise roster badges matching the specification:
 * (e.g. "GEMMA 9B", "GEMMA 4 2B", "GEMMA 2B", "QWEN 3B").
 */
export function formatRosterModelBadge(modelStr: string | undefined | null): string {
  if (!modelStr) return 'GEMMA 9B';
  const cleaned = String(modelStr)
    .replace(/\s*·\s*LOCAL$/i, '')
    .trim();
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('gemma 4') || lower.includes('4 e2b') || lower.includes('4:e2b')) return 'GEMMA 4 2B';
  if (lower.startsWith('gemma 2 9b') || lower.includes('2:9b') || (lower.includes('gemma') && lower.includes('9b')))
    return 'GEMMA 9B';
  if (lower.startsWith('gemma 2 2b') || lower.includes('2:2b') || (lower.includes('gemma') && lower.includes('2b')))
    return 'GEMMA 2B';
  if (lower.includes('qwen') && (lower.includes('3b') || lower.includes('2.5 3b'))) return 'QWEN 3B';
  if (lower.includes('qwen') && (lower.includes('7b') || lower.includes('coder'))) return 'QWEN 7B';
  if (lower.includes('qwen')) return 'QWEN 2.5';
  return cleaned;
}

/**
 * Creates realistic default swarm agents tailored to a goal.
 */
export function createDefaultSwarmAgents(goal: string, model: string = 'gemma2:9b'): SwarmAgent[] {
  const modelBadge = formatHeaderBadge(model);
  const worker1Model = formatHeaderBadge('gemma4:e2b');
  const worker2Model = formatHeaderBadge('gemma2:2b');
  const worker3Model = formatHeaderBadge('gemma2:2b');

  return [
    {
      id: 'coordinator',
      name: 'Coordinator',
      role: 'Swarm Orchestrator & Healer',
      state: 'working',
      model: modelBadge,
      branch: 'main',
      paneId: 'w0:p0',
      taskTitle: 'Supervise Swarm & Worktree Isolation',
      taskDesc: `Coordinate parallel workers for "${goal}", watch scrollback, and merge artifacts.`,
      latestTool: {
        name: 'plan_decomposition',
        args: `goal="${goal}"`,
        result: '4 parallel subtasks assigned to isolated git worktrees',
        time: 'just now',
      },
      gitDiff: [
        '+ swarm: parallel worktree isolation initialized',
        '+ workers: 4 autonomous agents allocated (2x2 grid)',
        '+ health: autonomous watcher active (healer zero-egress)',
      ],
    },
    {
      id: 'ignite-worker-1',
      name: 'Worker 1',
      role: 'HTML & 3D Spatial Viewport',
      state: 'working',
      model: worker1Model,
      branch: 'maos-ignite-0',
      paneId: 'w0:p1',
      taskTitle: 'Three.js Spatial Canvas & DOM Setup',
      taskDesc: 'Build responsive 3D canvas viewport container with orbital camera controls.',
      latestTool: {
        name: 'create_file',
        args: 'index.html',
        result: '58 lines written, canvas mount ready',
        time: '3s ago',
      },
      gitDiff: [
        'diff --git a/index.html b/index.html',
        'new file mode 100644',
        '+ <!DOCTYPE html>',
        '+ <html lang="en">',
        '+   <head><title>Canva 3D Spatial Studio</title></head>',
        '+   <body><canvas id="viewport"></canvas></body>',
        '+ </html>',
      ],
    },
    {
      id: 'ignite-worker-2',
      name: 'Worker 2',
      role: 'Scene Graph & Transform Hierarchy',
      state: 'working',
      model: worker2Model,
      branch: 'maos-ignite-1',
      paneId: 'w0:p2',
      taskTitle: 'SceneManager & Transform Engine',
      taskDesc: 'Implement SceneManager node graph, matrix transforms, and object selection.',
      latestTool: {
        name: 'create_file',
        args: 'src/scene.ts',
        result: '142 lines written, node graph compiled',
        time: '8s ago',
      },
      gitDiff: [
        'diff --git a/src/scene.ts b/src/scene.ts',
        '+ export class SceneManager {',
        '+   nodes = new Map<string, SceneNode>();',
        '+   addNode(node: SceneNode) { this.nodes.set(node.id, node); }',
        '+ }',
      ],
    },
    {
      id: 'ignite-worker-3',
      name: 'Worker 3',
      role: 'GLSL Shaders & Spatial Audio',
      state: 'working',
      model: worker3Model,
      branch: 'maos-ignite-2',
      paneId: 'w0:p3',
      taskTitle: 'Directional Lighting & Positional FX',
      taskDesc: 'Implement GLSL PBR lighting shaders and WebAudio 3D positional listener.',
      latestTool: {
        name: 'create_file',
        args: 'src/shaders/spatial.glsl',
        result: '86 lines written, shader compiled',
        time: '12s ago',
      },
      gitDiff: [
        'diff --git a/src/shaders/spatial.glsl b/src/shaders/spatial.glsl',
        '+ precision highp float;',
        '+ uniform vec3 uLightPos;',
        '+ void main() { gl_FragColor = vec4(uLightPos, 1.0); }',
      ],
    },
    {
      id: 'ignite-worker-4',
      name: 'Worker 4',
      role: 'Autonomous Verifier & Test Suite',
      state: 'done',
      model: modelBadge,
      branch: 'maos-ignite-3',
      paneId: 'w0:p4',
      taskTitle: 'Dynamic Compilation & Test Gate',
      taskDesc: 'Run Vitest suite, verify zero regression, and sign off merge readiness.',
      latestTool: {
        name: 'run_command',
        args: 'npm test',
        result: '18 passed, 0 failed (exit 0)',
        time: '15s ago',
      },
      gitDiff: [
        '✓ tests/canvas.test.ts (6 tests) 120ms',
        '✓ tests/scene.test.ts (8 tests) 180ms',
        '✓ tests/audio.test.ts (4 tests) 95ms',
        'All 18 tests passed. Branch green.',
      ],
    },
  ];
}

/**
 * Creates realistic default live activity stream posts.
 */
export function createDefaultSwarmPosts(goal: string): SwarmPost[] {
  return [
    {
      id: 1,
      sender: 'coordinator',
      recipient: '@ignite-worker-1',
      action: 'assign',
      text: 'You own the implementation of HTML & 3D Spatial Viewport',
      time: '00:01',
      type: 'message',
    },
    {
      id: 2,
      sender: 'coordinator',
      recipient: '@ignite-worker-2',
      action: 'assign',
      text: 'You own the implementation of Canva Engine & Scene Manager',
      time: '00:01',
      type: 'message',
    },
    {
      id: 3,
      sender: 'coordinator',
      recipient: '@ignite-worker-3',
      action: 'assign',
      text: 'You own the implementation of Spatial Audio & Lighting Shaders',
      time: '00:01',
      type: 'message',
    },
    {
      id: 4,
      sender: 'coordinator',
      recipient: '@ignite-worker-4',
      action: 'assign',
      text: 'You own the implementation of Autonomous Verifier & Test Suite',
      time: '00:01',
      type: 'message',
    },
    {
      id: 5,
      sender: 'ignite-worker-1',
      recipient: '@coordinator',
      action: 'create_file',
      text: 'create_file: index.html (58 lines written to worktree)',
      time: '00:04',
      type: 'tool',
    },
    {
      id: 6,
      sender: 'ignite-worker-2',
      recipient: '@coordinator',
      action: 'create_file',
      text: 'create_file: src/scene.ts (142 lines written to worktree)',
      time: '00:07',
      type: 'tool',
    },
    {
      id: 7,
      sender: 'ignite-worker-3',
      recipient: '@coordinator',
      action: 'create_file',
      text: 'create_file: src/shaders/spatial.glsl (86 lines written)',
      time: '00:10',
      type: 'tool',
    },
    {
      id: 8,
      sender: 'ignite-worker-4',
      recipient: '@coordinator',
      action: 'run_command',
      text: 'run_command: npm test (18 passed, 0 failed, exit code 0)',
      time: '00:14',
      type: 'tool',
    },
    {
      id: 9,
      sender: 'ignite-worker-1',
      recipient: '@coordinator',
      action: 'git_commit',
      text: 'git_commit: feat(viewport): canvas container initialized',
      time: '00:16',
      type: 'tool',
    },
    {
      id: 10,
      sender: 'ignite-worker-2',
      recipient: '@coordinator',
      action: 'git_commit',
      text: 'git_commit: feat(scene): hierarchy and transforms applied',
      time: '00:18',
      type: 'tool',
    },
    {
      id: 11,
      sender: 'coordinator',
      recipient: '@all',
      action: 'sync',
      text: 'Swarm synchronization barrier cleared · 4/4 branches green',
      time: '00:20',
      type: 'system',
    },
  ];
}

/**
 * Renders the complete Antigravity Swarm Board for Tab 3.
 */
export function renderSwarmBoard(
  state: SwarmBoardState,
  options: {
    width: number;
    height?: number;
    time?: number;
  },
): string[] {
  const W = Math.max(30, options.width);
  const time = options.time !== undefined ? options.time : Date.now() / 1000;
  const lines: string[] = [];
  const pad = (str: string | undefined | null, len: number) => fitTerminalLine(str, len);

  // Safe agent fallback
  const fallbackAgent: SwarmAgent = {
    id: 'coordinator',
    name: 'Coordinator',
    role: 'Swarm Orchestrator & Healer',
    state: 'working',
    model: formatHeaderBadge(state.model || 'gemma2:9b'),
    branch: 'main',
    paneId: 'w0:p0',
    taskTitle: 'Supervise Swarm & Worktree Isolation',
    taskDesc: 'The swarm is standing by. Enter a goal or run ignite to launch parallel workers.',
    gitDiff: ['+ swarm initialized and standing by'],
  };

  const agents = state.agents && state.agents.length > 0 ? state.agents : [fallbackAgent];
  const posts = Array.isArray(state.posts) ? state.posts : [];
  const goalText = state.goal ? state.goal : 'Build and deploy Canva 3D Spatial Studio';

  const validIndex = Number.isFinite(state.selectedAgentIndex) ? Number(state.selectedAgentIndex) : 0;
  const selectedIdx = Math.max(0, Math.min(agents.length - 1, validIndex));
  const selectedAgent = agents[selectedIdx] || agents[0];

  // ──────────────────────────────────────────────────────────────────────────
  // 1. HEADER WITH JELLYFISH MASCOT
  // ──────────────────────────────────────────────────────────────────────────
  const mascotLines = renderJellyfishMascot(time);
  const mascotWidth = W >= 60 ? 20 : Math.max(10, Math.floor(W * 0.35));
  const headerInfoWidth = Math.max(0, W - mascotWidth - 3);

  const activeCount = agents.filter((a) => a.state === 'working').length;
  const doneCount = agents.filter((a) => a.state === 'done').length;
  const statusColor = state.status === 'active' ? c.emerald : state.status === 'done' ? c.cyanBright : c.amber;
  const statusText = state.status === 'active' ? '● active' : state.status === 'done' ? '✓ complete' : '○ waiting';

  const infoRows: string[] = [
    `${c.boldWhite('Swarm board')} ${c.cyanBright(`"${pad(goalText, Math.max(6, headerInfoWidth - 28))}"`)}`,
    `${statusColor(statusText)}  ${c.slateBorder('·')}  ${c.white(String(agents.length))} ${c.slateText('agents')} (${c.cyanBright(String(activeCount) + ' working')}${doneCount > 0 ? ', ' + c.emerald(String(doneCount) + ' done') : ''})  ${c.slateBorder('·')}  ${c.violetBright(formatHeaderBadge(state.model || 'gemma2:9b'))}`,
    `${c.slateText('Target:')} ${c.white(pad(goalText, Math.max(6, headerInfoWidth - 10)))}`,
    `${c.slateText('Pipeline:')} ${c.emerald('Goal Decomposition')} ${c.slateMuted('→')} ${c.cyanBright('Parallel Panes')} ${c.slateMuted('→')} ${c.violetBright('Isolated Worktrees')} ${c.slateMuted('→')} ${c.emerald('Merge Barrier')}`,
    `${c.slateText('Swarm Health:')} ${c.emerald('Strict Loopback')} ${c.slateMuted('·')} ${c.slateText('Healer:')} ${c.cyanBright('Scrollback Watcher Active')} ${c.slateMuted('·')} ${c.slateText('Egress:')} ${c.emerald('0.00 KB')}`,
    `${c.slateText('Controls:')} ${c.boldWhite('↑/↓')} ${c.slateMuted('select agent')} ${c.slateBorder('·')} ${c.boldWhite('Enter')} ${c.slateMuted('toggle expand')} ${c.slateBorder('·')} ${c.boldWhite('P')} ${c.emerald('preview built artifacts')}`,
    c.slateBorder('─'.repeat(headerInfoWidth)),
    `${c.slateMuted('Antigravity CLI Swarm Engine')} ${c.slateBorder('│')} ${c.violetBright('Moon Jellyfish Swarm Kernel')}`,
  ];

  const headerHeight = Math.max(mascotLines.length, infoRows.length);
  for (let r = 0; r < headerHeight; r++) {
    const left = mascotLines[r] || ' '.repeat(mascotWidth);
    const right = infoRows[r] || '';
    lines.push(`${pad(left, mascotWidth)}${c.slateBorder(' │ ')}${pad(right, headerInfoWidth)}`);
  }

  lines.push(c.slateBorder('─'.repeat(W)));

  // ──────────────────────────────────────────────────────────────────────────
  // 2. EXPANDED VIEW OR NORMAL SPLIT VIEW
  // ──────────────────────────────────────────────────────────────────────────
  if (state.expanded) {
    const banner = `${c.cyanBright('◈')} ${c.boldWhite('EXPANDED SWARM INSPECTOR')} ${c.slateMuted('—')} ${c.cyanBright(selectedAgent.name)} ${c.slateMuted(`(${selectedAgent.id})`)} ${c.slateBorder('·')} ${c.slateMuted('Press Enter or Esc to collapse')}`;
    lines.push(pad(banner, W));
    lines.push(c.slateBorder('─'.repeat(W)));

    if (W >= 85) {
      // 2-column layout: Left = Mathematical Moon Jellyfish (38 cells), Right = Deep Inspector (W - 41 cells)
      const jellyWidth = 36;
      const jellyHeight = 16;
      const leftColWidth = 38;
      const rightColWidth = Math.max(30, W - leftColWidth - 3);

      const rawJelly = renderColoredJellyfish(time, jellyWidth, jellyHeight);
      const leftRows: string[] = [
        pad(c.cyanBright('MOON JELLYFISH SWARM KERNEL'), leftColWidth),
        c.slateBorder('─'.repeat(leftColWidth)),
        ...rawJelly.map((jl) => pad(jl, leftColWidth)),
        c.slateBorder('─'.repeat(leftColWidth)),
        pad(
          `${c.slateMuted('P: 2.2s')} ${c.slateBorder('·')} ${c.slateMuted('Squeeze:')} ${c.emerald((squeeze(time) * 100).toFixed(0) + '%')} ${c.slateBorder('·')} ${c.slateMuted('Lift:')} ${c.violetBright((lift(time) * 100).toFixed(0) + '%')}`,
          leftColWidth,
        ),
      ];

      const modelBadgeStr = formatRosterModelBadge(selectedAgent.model);
      const rightRows: string[] = [
        pad(
          `${c.cyanBright('Role:')} ${c.boldWhite(selectedAgent.role)}  ${c.slateBorder('│')}  ${c.slateText('Model:')} ${c.violetBright(modelBadgeStr)}`,
          rightColWidth,
        ),
        pad(
          `${c.slateText('Branch:')} ${c.cyan(selectedAgent.branch)}  ${c.slateBorder('│')}  ${c.slateText('Pane:')} ${c.white(selectedAgent.paneId || 'w0:p0')}  ${c.slateBorder('│')}  ${c.slateText('Status:')} ${selectedAgent.state === 'working' ? c.cyanBright('● working') : selectedAgent.state === 'done' ? c.emerald('✓ done') : c.amber('○ waiting')}`,
          rightColWidth,
        ),
        pad(`${c.slateText('Current Task:')} ${c.white(selectedAgent.taskTitle)}`, rightColWidth),
        pad(`${c.slateText('Specs:')} ${c.slateText(selectedAgent.taskDesc)}`, rightColWidth),
      ];

      if (selectedAgent.latestTool) {
        rightRows.push(
          pad(
            `${c.cyanBright('Latest Tool:')} ${c.boldWhite(selectedAgent.latestTool.name)} ${c.slateMuted(`(${selectedAgent.latestTool.args})`)} ${c.slateBorder('→')} ${c.emerald(selectedAgent.latestTool.result)} ${c.slateMuted(`[${selectedAgent.latestTool.time}]`)}`,
            rightColWidth,
          ),
        );
      } else {
        rightRows.push(pad(c.slateMuted('No tool calls dispatched yet.'), rightColWidth));
      }

      rightRows.push('');
      rightRows.push(c.slateBorder('╭' + '─'.repeat(Math.max(0, rightColWidth - 2)) + '╮'));
      rightRows.push(
        `${c.slateBorder('│ ')}${pad(c.boldWhite('WORKTREE GIT DIFF / VERIFICATION TRACE'), rightColWidth - 4)}${c.slateBorder(' │')}`,
      );
      rightRows.push(c.slateBorder('├' + '─'.repeat(Math.max(0, rightColWidth - 2)) + '┤'));

      const diffRows =
        selectedAgent.gitDiff && selectedAgent.gitDiff.length > 0 ? selectedAgent.gitDiff : ['+ No local diff'];
      for (const d of diffRows.slice(0, 9)) {
        const col = d.startsWith('+')
          ? c.emerald
          : d.startsWith('-')
            ? c.pink
            : d.startsWith('✓')
              ? c.emerald
              : c.slateText;
        rightRows.push(`${c.slateBorder('│ ')}${pad(col(d), rightColWidth - 4)}${c.slateBorder(' │')}`);
      }
      rightRows.push(c.slateBorder('╰' + '─'.repeat(Math.max(0, rightColWidth - 2)) + '╯'));

      const totalH = Math.max(leftRows.length, rightRows.length);
      for (let r = 0; r < totalH; r++) {
        const left = leftRows[r] || ' '.repeat(leftColWidth);
        const right = rightRows[r] || '';
        lines.push(`${pad(left, leftColWidth)}${c.slateBorder(' │ ')}${pad(right, rightColWidth)}`);
      }
    } else {
      // Single-column layout for narrow viewports
      const mascot = renderJellyfishMascot(time);
      for (const mLine of mascot) {
        lines.push(centerTerminalLine(mLine, W));
      }
      lines.push(
        pad(
          `${c.cyanBright('Role:')} ${c.boldWhite(selectedAgent.role)}  ${c.slateBorder('│')}  ${c.slateText('Branch:')} ${c.cyan(selectedAgent.branch)}  ${c.slateBorder('│')}  ${c.slateText('Status:')} ${selectedAgent.state === 'working' ? c.cyanBright('● working') : selectedAgent.state === 'done' ? c.emerald('✓ done') : c.amber('○ waiting')}`,
          W,
        ),
      );
      lines.push(pad(`${c.slateText('Task:')} ${c.white(selectedAgent.taskTitle)}`, W));
      lines.push(pad(`${c.slateText('Specs:')} ${c.slateText(selectedAgent.taskDesc)}`, W));
      if (selectedAgent.latestTool) {
        lines.push(
          pad(
            `${c.cyanBright('Tool:')} ${c.boldWhite(selectedAgent.latestTool.name)} ${c.slateMuted(`(${selectedAgent.latestTool.args})`)} → ${c.emerald(selectedAgent.latestTool.result)}`,
            W,
          ),
        );
      }
      lines.push('');
      lines.push(c.slateBorder('╭' + '─'.repeat(Math.max(0, W - 2)) + '╮'));
      lines.push(
        `${c.slateBorder('│ ')}${pad(c.boldWhite('WORKTREE GIT DIFF / VERIFICATION TRACE'), W - 4)}${c.slateBorder(' │')}`,
      );
      lines.push(c.slateBorder('├' + '─'.repeat(Math.max(0, W - 2)) + '┤'));
      const diffRows =
        selectedAgent.gitDiff && selectedAgent.gitDiff.length > 0 ? selectedAgent.gitDiff : ['+ No local diff'];
      for (const d of diffRows.slice(0, 6)) {
        const col = d.startsWith('+')
          ? c.emerald
          : d.startsWith('-')
            ? c.pink
            : d.startsWith('✓')
              ? c.emerald
              : c.slateText;
        lines.push(`${c.slateBorder('│ ')}${pad(col(d), W - 4)}${c.slateBorder(' │')}`);
      }
      lines.push(c.slateBorder('╰' + '─'.repeat(Math.max(0, W - 2)) + '╯'));
    }

    lines.push(c.slateBorder('─'.repeat(W)));
    lines.push(
      pad(
        `${c.boldWhite('Enter / Esc')} ${c.slateMuted('collapse')}  ${c.slateBorder('·')}  ${c.boldWhite('↑/↓')} ${c.slateMuted('select agent')}  ${c.slateBorder('·')}  ${c.boldWhite('P')} ${c.emerald('preview built artifacts')}`,
        W,
      ),
    );
    return lines;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. NORMAL VIEW: ROSTER (LEFT) + POSTS STREAM (RIGHT)
  // ──────────────────────────────────────────────────────────────────────────
  const availableMid = Math.max(10, W - 3);
  const rosterWidth = Math.max(16, Math.min(38, Math.floor(availableMid * 0.38)));
  const postsWidth = availableMid - rosterWidth;

  // Roster lines:
  const rosterHeader = `${c.cyanBright('ROSTER')} ${c.slateMuted(`(${agents.length} agents)`)}`;
  const rosterLines: string[] = [rosterHeader, c.slateBorder('─'.repeat(rosterWidth))];

  agents.forEach((ag, idx) => {
    const isSelected = idx === selectedIdx;
    const bullet = ag.state === 'working' ? c.cyanBright('●') : ag.state === 'done' ? c.emerald('✓') : c.amber('○');
    const pointer = isSelected ? c.cyanBright('▶ ') : '  ';
    const namePart = isSelected ? c.boldWhite(ag.id) : c.white(ag.id);
    const badgeText = formatRosterModelBadge(ag.model);
    const badge = c.slateMuted(`[${badgeText}]`);
    const line1 = `${pointer}${bullet} ${namePart} ${badge}`;
    const line2 = `     ${c.slateText(pad(ag.role, Math.max(0, rosterWidth - 6)))}`;
    rosterLines.push(line1);
    rosterLines.push(line2);
  });

  // Posts lines (Live Activity Stream):
  const postsHeader = `${c.cyanBright('POSTS')} ${c.slateMuted(`(${posts.length} activity entries)`)}`;
  const postsLines: string[] = [postsHeader, c.slateBorder('─'.repeat(postsWidth))];

  const maxPosts = options.height && options.height > 30 ? 14 : 8;
  const recentPosts = posts.slice(-maxPosts);
  if (recentPosts.length === 0) {
    postsLines.push(c.slateMuted('  No activity recorded yet. Swarm is standing by.'));
  } else {
    for (const post of recentPosts) {
      const pNum = c.violetBright(`#${post.id}`);
      const sender = post.sender === 'coordinator' ? c.boldWhite(post.sender) : c.cyan(post.sender);
      const recip = c.cyanBright(post.recipient);
      const text =
        post.action === 'create_file'
          ? c.emerald(post.text)
          : post.action === 'run_command'
            ? c.cyanBright(post.text)
            : post.action === 'git_commit'
              ? c.violetBright(post.text)
              : c.white(post.text);
      postsLines.push(`${c.cyanBright('>')} ${pNum} ${sender} ${recip} ${text}`);
    }
  }

  // Combine Roster (left) and Posts (right):
  const midHeight = Math.max(rosterLines.length, postsLines.length);
  for (let r = 0; r < midHeight; r++) {
    const left = rosterLines[r] || ' '.repeat(rosterWidth);
    const right = postsLines[r] || '';
    lines.push(`${pad(left, rosterWidth)}${c.slateBorder(' │ ')}${pad(right, postsWidth)}`);
  }

  lines.push(c.slateBorder('─'.repeat(W)));

  // ──────────────────────────────────────────────────────────────────────────
  // 4. MESSAGE / DETAIL INSPECTOR (BOTTOM PANEL)
  // ──────────────────────────────────────────────────────────────────────────
  const inspectorLabel = ` Inspector: ${selectedAgent.id} [${selectedAgent.role}] `;
  const fittedLabel = fitTerminalLine(inspectorLabel, Math.max(0, W - 6));
  const remainingBorder = Math.max(0, W - terminalCellWidth(fittedLabel) - 4);
  lines.push(c.slateBorder(`╭──${fittedLabel}${'─'.repeat(remainingBorder)}╮`));

  const taskRow = `${c.slateText('Task:')} ${c.white(selectedAgent.taskTitle)}  ${c.slateBorder('│')}  ${c.slateText('Branch:')} ${c.cyan(selectedAgent.branch)}`;
  lines.push(`${c.slateBorder('│ ')}${pad(taskRow, Math.max(0, W - 4))}${c.slateBorder(' │')}`);

  if (selectedAgent.latestTool) {
    const toolRow = `${c.slateText('Latest Tool:')} ${c.cyanBright(selectedAgent.latestTool.name)} ${c.slateMuted(`(${selectedAgent.latestTool.args})`)} ${c.slateBorder('→')} ${c.emerald(selectedAgent.latestTool.result)}`;
    lines.push(`${c.slateBorder('│ ')}${pad(toolRow, Math.max(0, W - 4))}${c.slateBorder(' │')}`);
  }

  if (selectedAgent.gitDiff && selectedAgent.gitDiff.length > 0) {
    const diffSample = selectedAgent.gitDiff
      .slice(0, 2)
      .map((d) => (d.startsWith('+') ? c.emerald(d) : c.slateText(d)))
      .join('  ');
    const diffRow = `${c.slateText('Diff:')} ${diffSample}`;
    lines.push(`${c.slateBorder('│ ')}${pad(diffRow, Math.max(0, W - 4))}${c.slateBorder(' │')}`);
  }

  lines.push(c.slateBorder('╰' + '─'.repeat(Math.max(0, W - 2)) + '╯'));

  return lines;
}
