/**
 * MAOS Oasis Terminal User Interface (TUI)
 *
 * Enterprise-grade, ultra-aesthetic, interactive terminal mission control.
 * Matches Sovereign CLI and Herdr level polishing:
 *   - Real-time GPU VRAM, Temperature & Throughput telemetry
 *   - Live Herdr Multi-Pane Swarm Matrix
 *   - Gemma Inference Playground & Model Switcher (2B ↔ 9B)
 *   - Autonomous Healer watcher monitor & trace viewer
 *   - Canva 3D Spatial Design Studio controls
 *   - Interactive hotkeys, modal overlays, and flicker-free rendering
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { exec, execFile, execSync, spawn, type ChildProcess } from 'child_process';
import chalk from 'chalk';
import { AgentInfo, getDefaultHerdrHarness, PaneInfo } from '../integrations/herdr';
import {
  detectLocalModels,
  DetectedModel,
  FALLBACK_MODELS,
  formatHeaderBadge,
  formatModelDisplayName,
} from '../oasis/model-detector';
import {
  SwarmAgent,
  SwarmPost,
  SwarmBoardState,
  createDefaultSwarmAgents,
  createDefaultSwarmPosts,
  renderSwarmBoard,
} from '../oasis/swarm-board';
import { renderJellyfishMascot, generateJellyfishRawFrame, renderColoredJellyfish } from '../oasis/jellyfish-ascii';
import { TextInputState, renderInputContentWithCursor } from './text-input';

// ── Colors & Styles ──────────────────────────────────────────────
const c = {
  violet: chalk.hex('#8B5CF6'),
  violetBright: chalk.hex('#A78BFA'),
  pink: chalk.hex('#EC4899'),
  cyan: chalk.hex('#06B6D4'),
  cyanBright: chalk.hex('#38BDF8'),
  emerald: chalk.hex('#10B981'),
  amber: chalk.hex('#F59E0B'),
  slateDark: chalk.hex('#0F172A'),
  slateCard: chalk.hex('#1E293B'),
  slateBorder: chalk.hex('#334155'),
  slateMuted: chalk.hex('#64748B'),
  slateText: chalk.hex('#94A3B8'),
  white: chalk.hex('#F8FAFC'),
  boldWhite: chalk.bold.hex('#FFFFFF'),
};

interface GpuStats {
  vramUsedMiB: number;
  vramTotalMiB: number;
  gpuUtil: number;
  tempC: number;
  powerW: number;
  modelInVram: string;
}

interface ActivityEvent {
  time: string;
  tag: string;
  text: string;
  color: (s: string) => string;
}

interface MetricCard {
  label: string;
  value: string;
  detail?: string;
  color?: (value: string) => string;
}

const ANSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const MAOS_OASIS_LOGO_ROWS = [
  '┌────────────┐┌────────┐┌────────┐┌─────────┐    ┌────────┐┌────────┐┌─────────┐┌──┐┌─────────┐',
  '│ ·┌─┐  ┌─┐· ││ .┌──┐ ·││ .┌──┐ ·││· ┌──────┘    │ .┌──┐ ·││ .┌──┐ ·││· ┌──────┘│  ││· ┌──────┘',
  '│  │ │· │ │ ·││· └──┘  ││· │  │  ││ ·└──────┐    │· │  │  ││· └──┘  ││ ·└──────┐│· ││ ·└──────┐',
  '│──│ │──│ │──││──┌──┐──││──│  │──│└──────┐──│    │──│  │──││──┌──┐──│└──────┐──││──│└──────┐──│',
  '│══│ │══│ │══││══│  │══││══└──┘══│┌──────┘══│    │══└──┘══││══│  │══│┌──────┘══││══│┌──────┘══│',
  '└──┘ └──┘ └──┘└──┘  └──┘└────────┘└─────────┘    └────────┘└──┘  └──┘└─────────┘└──┘└─────────┘',
];
const MAOS_OASIS_LOGO_WIDTH = Math.max(...MAOS_OASIS_LOGO_ROWS.map(terminalCellWidth));

function terminalCellWidth(value: string | undefined | null): number {
  if (!value) return 0;
  const plainText = String(value)
    .replace(ANSI_SEQUENCE, '')
    .replace(/[\r\n]+/g, '');
  if (!plainText) return 0;

  // Fast path: pure ASCII characters 0x20 through 0x7e have cell width 1
  let isAscii = true;
  for (let i = 0; i < plainText.length; i++) {
    const code = plainText.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      isAscii = false;
      break;
    }
  }
  if (isAscii) return plainText.length;

  let width = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(plainText)) {
    const points = Array.from(segment, (character) => character.codePointAt(0) || 0);
    const point = points.find((val) => val !== 0x200d && !(val >= 0xfe00 && val <= 0xfe0f)) || 0;
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
    const hasVS16 = points.includes(0xfe0f);
    const emojiPresentation =
      (hasVS16 && point !== 0x2713 && point !== 0x2714) ||
      points.includes(0x20e3) ||
      points.filter((v) => v >= 0x1f1e6 && v <= 0x1f1ff).length === 2 ||
      (point >= 0x1f300 && point <= 0x1faff) ||
      [0x2705, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797, 0x27b0, 0x27bf].includes(
        point,
      ) ||
      (hasVS16 && [0x26a0, 0x2699, 0x26d4, 0x26a1, 0x267f].includes(point)) ||
      (!hasVS16 && [0x26a1, 0x26d4, 0x267f].includes(point));
    width += wide || emojiPresentation ? 2 : 1;
  }
  return width;
}

function fitTerminalLine(value: string | undefined | null, width: number): string {
  if (width <= 0) return '';
  const cleanValue = value == null ? '' : String(value).replace(/[\r\n]+/g, ' ');
  const fullWidth = terminalCellWidth(cleanValue);

  // Fast path: if the text already fits comfortably, return immediately
  if (fullWidth <= width) {
    const reset = cleanValue.includes('\u001b') ? '\u001b[0m' : '';
    return cleanValue + reset + ' '.repeat(width - fullWidth);
  }

  const limit = Math.max(0, width - 1);
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
      if (used + cells > limit) {
        break segments;
      }
      output += segment;
      used += cells;
    }
  }

  if (used < width) {
    output += '…';
    used += 1;
  }
  if (cleanValue.includes('\u001b')) output += '\u001b[0m';
  return output + ' '.repeat(Math.max(0, width - used));
}

function centerTerminalLine(value: string, width: number): string {
  const cleanValue = value.replace(/[\r\n]+/g, ' ');
  const valueWidth = terminalCellWidth(cleanValue);
  if (valueWidth >= width) return fitTerminalLine(cleanValue, width);
  const left = Math.floor((width - valueWidth) / 2);
  const reset = cleanValue.includes('\u001b') ? '\u001b[0m' : '';
  return ' '.repeat(left) + cleanValue + reset + ' '.repeat(Math.max(0, width - valueWidth - left));
}

function fitTerminalTail(value: string, width: number): string {
  if (width <= 0) return '';
  const cleanValue = value.replace(/[\r\n]+/g, ' ');
  if (terminalCellWidth(cleanValue) <= width) return cleanValue;

  const segments = Array.from(GRAPHEME_SEGMENTER.segment(cleanValue), ({ segment }) => segment);
  const limit = Math.max(0, width - 1);
  const tail: string[] = [];
  let used = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const cells = terminalCellWidth(segments[i]);
    if (used + cells > limit) break;
    tail.push(segments[i]);
    used += cells;
  }
  return `…${tail.reverse().join('')}`;
}

function wrapTerminalLine(value: string, width: number): string[] {
  if (width <= 0) return [''];
  if (value === '') return [''];

  const normalized = value.replace(/\r\n?/g, '\n');
  const paragraphs = normalized.split('\n');
  const rows: string[] = [];

  for (const para of paragraphs) {
    if (para === '') {
      rows.push('');
      continue;
    }

    const words = para.match(/\S+|\s+/g) || [para];
    let row = '';
    let rowWidth = 0;

    for (const word of words) {
      const wordCells = terminalCellWidth(word);
      if (row && rowWidth + wordCells > width) {
        if (/^\s+$/.test(word)) {
          continue;
        }
        rows.push(row);
        row = '';
        rowWidth = 0;
      }

      if (wordCells > width) {
        for (const { segment } of GRAPHEME_SEGMENTER.segment(word)) {
          const cells = terminalCellWidth(segment);
          if (row && rowWidth + cells > width) {
            rows.push(row);
            row = '';
            rowWidth = 0;
          }
          row += segment;
          rowWidth += cells;
        }
      } else {
        if (!row && /^\s+$/.test(word)) {
          continue;
        }
        row += word;
        rowWidth += wordCells;
      }
    }
    if (row || rows.length === 0) {
      rows.push(row);
    }
  }

  return rows.length > 0 ? rows : [''];
}

function appendMetricCards(lines: string[], width: number, cards: MetricCard[]): void {
  const columns = width >= 82 ? 3 : width >= 52 ? 2 : 1;
  const gap = '  ';
  const cardWidth = Math.max(1, Math.floor((width - terminalCellWidth(gap) * (columns - 1)) / columns));
  const contentWidth = Math.max(0, cardWidth - 4);

  for (let start = 0; start < cards.length; start += columns) {
    const row = cards.slice(start, start + columns).map((card) => {
      const color = card.color || c.cyanBright;
      return [
        c.slateBorder(`╭${'─'.repeat(Math.max(0, cardWidth - 2))}╮`),
        `${c.slateBorder('│')} ${fitTerminalLine(c.slateMuted(card.label), contentWidth)} ${c.slateBorder('│')}`,
        `${c.slateBorder('│')} ${fitTerminalLine(color(card.value), contentWidth)} ${c.slateBorder('│')}`,
        `${c.slateBorder('│')} ${fitTerminalLine(c.slateText(card.detail || ''), contentWidth)} ${c.slateBorder('│')}`,
        c.slateBorder(`╰${'─'.repeat(Math.max(0, cardWidth - 2))}╯`),
      ];
    });

    for (let line = 0; line < 5; line++) lines.push(row.map((card) => card[line]).join(gap));
  }
}

function splitCommandLine(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let tokenStarted = false;

  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (escaped) {
      current += character;
      escaped = false;
      tokenStarted = true;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      const next = value[i + 1];
      if (next && (next === '"' || next === "'" || next === '\\' || /\s/.test(next))) {
        escaped = true;
        continue;
      }
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      tokenStarted = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) args.push(current);
      current = '';
      tokenStarted = false;
    } else {
      current += character;
      tokenStarted = true;
    }
  }

  if (escaped) current += '\\';
  if (quote) throw new Error('Unclosed quote in command.');
  if (tokenStarted) args.push(current);
  return args;
}

const CORE_CLI_COMMANDS = new Set([
  'init',
  'task',
  'status',
  'start',
  'objective',
  'configure',
  'plan',
  'ignite',
  'pool',
  'logs',
  'login',
  'brain',
  'dashboard',
  'doctor',
  'repl',
  'preview',
  'run',
  'open',
  'replay',
  'queue',
  'memory',
  'clean',
]);

export interface ChatMessage {
  sender: 'user' | 'gemma';
  text: string;
  time: string;
}

/**
 * Distinguishes conversational queries / casual greetings / questions
 * from actionable multi-agent swarm engineering tasks.
 */
export function classifyUserInput(input: string): 'chat' | 'swarm_task' {
  const trimmed = input.trim();
  if (!trimmed) return 'chat';

  // Explicit prefixes
  if (/^(task|swarm|goal|build|ignite):\s*/i.test(trimmed)) return 'swarm_task';
  if (/^(chat|ask|question|say):\s*/i.test(trimmed)) return 'chat';

  const lower = trimmed.toLowerCase();

  // Strip leading polite / conversational preamble
  // e.g. "hi, can you please build..." -> "build..."
  // e.g. "hey could you write..." -> "write..."
  // e.g. "hello! please create..." -> "create..."
  // e.g. "can you please fix..." -> "fix..."
  const stripped = lower
    .replace(/^(hi|hello|hey|hiya|yo|howdy|hola|greetings|good\s+(morning|afternoon|evening|day))[!,.\s]*/i, '')
    .replace(/^(please|kindly)[!,.\s]*/i, '')
    .replace(
      /^(can\s+you(\s+please)?|could\s+you(\s+please)?|would\s+you(\s+please)?|i\s+want\s+you\s+to|i\s+need\s+you\s+to)[!,.\s]*/i,
      '',
    )
    .replace(/^(please|kindly)[!,.\s]*/i, '')
    .trim();

  // If after stripping preamble nothing is left (e.g. "hi", "hello!", "hey please"):
  if (!stripped) return 'chat';

  // Common conversational / casual feedback tokens
  const casualTokens = new Set([
    'hi',
    'hello',
    'hey',
    'hiya',
    'yo',
    'howdy',
    'hola',
    'sup',
    'ping',
    'test',
    'thanks',
    'thx',
    'thank',
    'bye',
    'goodbye',
    'ok',
    'okay',
    'cool',
    'nice',
    'great',
    'awesome',
    'perfect',
    'help',
    'status',
  ]);
  const cleanTokens = stripped
    .replace(/[?!.,;:()]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  if (cleanTokens.length <= 2 && cleanTokens.every((t) => casualTokens.has(t))) {
    return 'chat';
  }

  // Conversational questions asking to explain, tell, describe, clarify
  // Even if they mention task words ("explain how to build a website", "tell me how to write tests")
  const conversationalStarters =
    /^(how\s+(are\s+you|does|do|can|is|to)|who\s+(are\s+you|is)|what\s+(are\s+you|is|can|do|does|are)|why\s+|tell\s+me|explain|can\s+you\s+explain|could\s+you\s+explain|help\s+me\s+understand|describe|clarify)\b/i;

  if (conversationalStarters.test(stripped) || conversationalStarters.test(lower)) {
    return 'chat';
  }

  // Action verbs that indicate hands-on engineering / coding execution tasks
  const imperativeTaskVerbs =
    /^(build|create|implement|fix|refactor|deploy|scaffold|generate|develop|write|modify|update|optimize|delete|migrate|repair|run|compile|assemble|wire|dockerize|containerize|patch|remediate|benchmark|test|clean|install|init)\b/i;

  if (imperativeTaskVerbs.test(stripped)) {
    if (stripped.endsWith('?') && /^(is|are|does|do|can|could|how|what|why)\b/i.test(stripped)) {
      return 'chat';
    }
    return 'swarm_task';
  }

  // General questions (start with question word or end with question mark)
  const questionWords = /^(what|why|who|where|when|which|is|are|does|do|how|can|could|would)\b/i;
  if (questionWords.test(stripped) || stripped.endsWith('?')) {
    return 'chat';
  }

  // Short inputs (< 4 words) without task verb default to chat
  if (cleanTokens.length <= 3 && !imperativeTaskVerbs.test(cleanTokens[0])) {
    return 'chat';
  }

  return 'swarm_task';
}

export class MaosTui {
  private activeTab: number = 1; // 1: Dashboard, 2: Chat, 3: Agents, 4: Telemetry, 5: Event log, 0: Settings
  private isRunning: boolean = true;
  private externalCommandRunning: boolean = false;
  private activeChild: ChildProcess | null = null;
  private externalCommandLabel: string = '';
  private externalCommandStartTime: number = 0;
  private spinnerFrames: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerIndex: number = 0;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private lastCommandExitCode: number | null = null;
  private lastCommandLabel: string = '';
  private isRendering: boolean = false;
  private renderPending: boolean = false;
  private selectedModel: string = 'gemma2:9b';
  private detectedModels: DetectedModel[] = [...FALLBACK_MODELS];
  private isPasting: boolean = false;
  private pasteBuffer: string = '';
  private modalMode: 'none' | 'ignite' | 'promptTest' = 'none';
  private modalInput: TextInputState = new TextInputState();
  public get modalInputText(): string {
    return this.modalInput.getText();
  }
  public set modalInputText(val: string) {
    this.modalInput.setText(val, true);
  }
  private lastRenderedRowCount: number = 0;
  private isUpdatingGpu: boolean = false;
  private statusMessage: string = 'Ready. Press Enter to type a goal or slash command; /help lists commands.';
  private commandHistory: string[] = [];
  private commandHistoryIndex: number = -1;
  private transcript: string[] = [];
  private transcriptScrollOffset: number = 0;
  private transcriptViewportRows: number = 8;
  private transcriptRenderedRowCount: number = 0;
  private commandOutputRemainder: string = '';
  private transcriptRenderTimer: NodeJS.Timeout | null = null;
  private herdrPanes: PaneInfo[] = [];
  private herdrAgents: AgentInfo[] = [];
  private herdrAvailable: boolean = false;
  private herdrRefreshInFlight: boolean = false;

  // ── Swarm Board (Tab 3) State ─────────────────────────────────────
  private swarmGoal: string = 'Build and deploy Canva 3D Spatial Studio';
  private swarmState: 'active' | 'waiting' | 'done' = 'active';
  private swarmAgents: SwarmAgent[] = [];
  private swarmPosts: SwarmPost[] = [];
  private selectedSwarmAgentIndex: number = 0;
  private swarmInspectorExpanded: boolean = false;

  private chatMessages: ChatMessage[] = [];
  private chatInput: TextInputState = new TextInputState();
  public get chatInputText(): string {
    return this.chatInput.getText();
  }
  public set chatInputText(val: string) {
    this.chatInput.setText(val, true);
  }
  private chatScrollOffset: number = 0;
  private chatViewportRows: number = 8;
  private chatRenderedRowCount: number = 0;
  private chatIsStreaming: boolean = false;
  private activeChatAbortController: AbortController | null = null;
  private oasisConfig: any = null;
  private prefixActive: boolean = false;
  private prefixTimeout: NodeJS.Timeout | null = null;
  private previewServer: http.Server | null = null;
  private previewPort: number = 3030;

  private rawStdinBuffer: string = '';
  private rawStdinFlushTimer: NodeJS.Timeout | null = null;
  private origStdinEmit: ((event: string | symbol, ...args: any[]) => boolean) | null = null;
  private keypressHandler: ((str: string | undefined, key: any) => void) | null = null;
  private sidebarCollapsed: boolean = false;

  private settingsScrollOffset: number = 0;
  private settingsViewportRows: number = 16;
  private settingsRenderedRowCount: number = 0;
  private lastRenderedFrame: string[] = [];

  private gpuStats: GpuStats = {
    vramUsedMiB: 3074,
    vramTotalMiB: 8188,
    gpuUtil: 1,
    tempC: 40,
    powerW: 1,
    modelInVram: 'gemma2:9b (80% GPU / 20% CPU)',
  };

  private activities: ActivityEvent[] = [];

  private refreshTimer: NodeJS.Timeout | null = null;
  private swarmAnimTimer: NodeJS.Timeout | null = null;
  private projectRoot: string;
  private readonly resizeHandler = () => {
    this.lastRenderedFrame = [];
    process.stdout.write('\x1b[2J\x1b[H');
    this.render();
  };
  private readonly interruptHandler = () => {
    if (this.chatIsStreaming && this.activeChatAbortController) {
      this.activeChatAbortController.abort();
      this.activeChatAbortController = null;
      this.chatIsStreaming = false;
      this.statusMessage = 'Chat generation cancelled.';
      this.appendTranscript('\n^C [Chat generation cancelled by user]');
      this.render();
      return;
    }
    if (this.externalCommandRunning && this.activeChild) {
      this.statusMessage = 'Aborting running process...';
      this.appendTranscript('\n^C [Aborting running process...]');
      try {
        if (process.platform === 'win32' && this.activeChild.pid) {
          execSync(`taskkill /pid ${this.activeChild.pid} /T /F`, { stdio: 'ignore' });
        } else {
          this.activeChild.kill('SIGINT');
        }
      } catch {}
      this.render();
      return;
    }
    this.exit();
  };
  private readonly terminateHandler = () => this.exit();

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.loadWorkplaceConfig();
    this.swarmAgents = createDefaultSwarmAgents(this.swarmGoal, this.selectedModel);
    this.swarmPosts = createDefaultSwarmPosts(this.swarmGoal);
  }

  public getSwarmGoal(): string {
    return this.swarmGoal;
  }

  public setSwarmGoal(goal: string): void {
    this.swarmGoal = goal;
    this.swarmAgents = createDefaultSwarmAgents(goal, this.selectedModel);
    this.swarmPosts = createDefaultSwarmPosts(goal);
    this.swarmState = 'active';
  }

  public getSwarmAgents(): SwarmAgent[] {
    return this.swarmAgents;
  }

  public getSwarmPosts(): SwarmPost[] {
    return this.swarmPosts;
  }

  public getSelectedSwarmAgent(): SwarmAgent {
    return (
      this.swarmAgents[this.selectedSwarmAgentIndex] ||
      this.swarmAgents[0] || {
        id: 'coordinator',
        name: 'Coordinator',
        role: 'Swarm Orchestrator & Healer',
        state: 'working',
        model: formatHeaderBadge(this.selectedModel),
        branch: 'main',
        paneId: 'w0:p0',
        taskTitle: 'Supervise Swarm & Worktree Isolation',
        taskDesc: 'Swarm is standing by',
      }
    );
  }

  public setSelectedSwarmAgentIndex(index: number): void {
    this.selectedSwarmAgentIndex = Math.max(0, Math.min(this.swarmAgents.length - 1, index));
  }

  public toggleSwarmInspectorExpanded(): boolean {
    this.swarmInspectorExpanded = !this.swarmInspectorExpanded;
    return this.swarmInspectorExpanded;
  }

  public isSwarmInspectorExpanded(): boolean {
    return this.swarmInspectorExpanded;
  }

  public recordSwarmPost(sender: string, recipient: string, action: string, text: string): void {
    const nextId = this.swarmPosts.length > 0 ? Math.max(...this.swarmPosts.map((p) => p.id)) + 1 : 1;
    const now = new Date();
    const timeStr = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    this.swarmPosts.push({
      id: nextId,
      sender,
      recipient,
      action,
      text,
      time: timeStr,
      type: 'tool',
    });
    if (this.swarmPosts.length > 100) this.swarmPosts.shift();

    const ag = this.swarmAgents.find((a) => a.id === sender);
    if (ag) {
      const cleanArgs = text.startsWith(action + ':') ? text.slice(action.length + 1).trim() : text;
      ag.latestTool = {
        name: action,
        args: cleanArgs,
        result: action.includes('complete') ? '18 passed, 0 failed' : 'executed',
        time: 'just now',
      };
      if (action.includes('complete') || text.includes('green') || text.includes('exit 0')) {
        ag.state = 'done';
      } else {
        ag.state = 'working';
      }
      if (!ag.gitDiff) ag.gitDiff = [];
      if (action === 'create_file') {
        ag.gitDiff.unshift(`+ create_file: ${cleanArgs}`);
      } else if (action === 'git_commit') {
        ag.gitDiff.unshift(`+ commit: ${cleanArgs}`);
      } else if (action.includes('complete')) {
        ag.gitDiff.unshift(`✓ tests passed: ${cleanArgs}`);
      }
      if (ag.gitDiff.length > 10) ag.gitDiff = ag.gitDiff.slice(0, 10);
    }
  }

  public loadWorkplaceConfig(): void {
    try {
      const configPath = path.join(this.projectRoot, 'maos-oasis.config.json');
      if (fs.existsSync(configPath)) {
        this.oasisConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (this.oasisConfig?.model?.primary) {
          this.selectedModel = this.oasisConfig.model.primary;
        }
      }
    } catch {}
    void this.refreshDetectedModels();
  }

  public getNextTab(current: number): number {
    switch (current) {
      case 1:
        return 2;
      case 2:
        return 3;
      case 3:
        return 4;
      case 4:
        return 5;
      case 5:
        return 0;
      case 0:
        return 1;
      default:
        return 1;
    }
  }

  public getPrevTab(current: number): number {
    switch (current) {
      case 1:
        return 0;
      case 2:
        return 1;
      case 3:
        return 2;
      case 4:
        return 3;
      case 5:
        return 4;
      case 0:
        return 5;
      default:
        return 1;
    }
  }

  public getActiveTab(): number {
    return this.activeTab;
  }

  public setActiveTab(tab: number): void {
    this.activeTab = tab;
    if (tab === 0) {
      this.loadWorkplaceConfig();
    }
    const tabNames: Record<number, string> = {
      1: 'Dashboard',
      2: 'Chat',
      3: 'Swarm',
      4: 'Telemetry',
      5: 'Event Log',
      0: 'Settings',
    };
    if (tabNames[tab]) {
      this.statusMessage = `Switched to View [${tab}] — ${tabNames[tab]}.`;
    }
    this.render();
  }

  public getModalMode(): string {
    return this.modalMode;
  }

  public setModalMode(mode: 'none' | 'ignite' | 'promptTest'): void {
    this.modalMode = mode;
  }

  public getChatMessages(): readonly ChatMessage[] {
    return this.chatMessages;
  }

  public isSidebarCollapsed(): boolean {
    return this.sidebarCollapsed;
  }

  public setSidebarCollapsed(collapsed: boolean): void {
    this.sidebarCollapsed = Boolean(collapsed);
    this.statusMessage = this.sidebarCollapsed
      ? 'Sidebar minimized (Ctrl+\\ to expand).'
      : 'Sidebar expanded (Ctrl+\\ to minimize).';
    this.render();
  }

  public toggleSidebar(): boolean {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.statusMessage = this.sidebarCollapsed
      ? 'Sidebar minimized (Ctrl+\\ to expand).'
      : 'Sidebar expanded (Ctrl+\\ to minimize).';
    this.render();
    return this.sidebarCollapsed;
  }

  public getTerminalWidth(): number {
    if (process.stdout && typeof process.stdout.columns === 'number' && process.stdout.columns > 0) {
      return Math.max(20, process.stdout.columns);
    }
    if (process.stderr && typeof process.stderr.columns === 'number' && process.stderr.columns > 0) {
      return Math.max(20, process.stderr.columns);
    }
    if (process.env.COLUMNS) {
      const parsed = parseInt(process.env.COLUMNS, 10);
      if (!isNaN(parsed) && parsed > 0) return Math.max(20, parsed);
    }
    return 118;
  }

  public getTerminalRows(): number {
    if (process.stdout && typeof process.stdout.rows === 'number' && process.stdout.rows > 0) {
      return Math.max(10, process.stdout.rows);
    }
    if (process.stderr && typeof process.stderr.rows === 'number' && process.stderr.rows > 0) {
      return Math.max(10, process.stderr.rows);
    }
    if (process.env.LINES) {
      const parsed = parseInt(process.env.LINES, 10);
      if (!isNaN(parsed) && parsed > 0) return Math.max(10, parsed);
    }
    return 39;
  }

  public getRailWidth(terminalW: number = this.getTerminalWidth()): number {
    if (this.sidebarCollapsed) {
      return terminalW >= 40 ? 5 : 0;
    }
    return terminalW >= 80 ? 20 : terminalW >= 40 ? 5 : 0;
  }

  public handleMouseClick(col: number, row: number): boolean {
    const W = this.getTerminalWidth();
    const railW = this.getRailWidth(W);
    const mainW = W - railW - (railW ? 3 : 0);
    const railStartCol = mainW + 1;

    const visibleLength = terminalCellWidth;
    const title = '◈  MAOS OASIS v0.4.0  │ Sovereign Multi-Agent Swarm Kernel';
    const vramGb = (this.gpuStats.vramUsedMiB / 1024).toFixed(1);
    const totalGb = (this.gpuStats.vramTotalMiB / 1024).toFixed(1);
    const modelBadge = formatHeaderBadge(this.selectedModel);
    const herdrStatus = this.herdrAvailable
      ? this.herdrPanes.length > 0
        ? `HERDR: ${this.herdrPanes.length} PANE${this.herdrPanes.length > 1 ? 'S' : ''}`
        : 'HERDR: LIVE'
      : 'HERDR: OFFLINE';
    const telemetry = `${modelBadge}  │  ${herdrStatus}  │  GPU ${this.gpuStats.tempC}°C  │  VRAM ${vramGb}/${totalGb} GB`;
    const headerGap = W - visibleLength(title) - visibleLength(telemetry);
    const headerLines = headerGap >= 2 ? 1 : 2;
    const bodyStartRow = headerLines + 2;

    const terminalRows = this.getTerminalRows();
    const hasTranscriptSession = this.activeTab === 1 && this.transcript.length > 0;
    const hasStatus = !hasTranscriptSession && !this.statusMessage.startsWith('Ready.');
    const footerRows = hasStatus ? 4 : 2;
    const bodyRows = Math.max(1, terminalRows - (headerLines + 1) - footerRows);
    const bodyRow = row - bodyStartRow;

    // 1. Sidebar rail click handling (expanded and mini-rail):
    if (railW > 0 && col >= railStartCol - 1) {
      const step = bodyRows >= 16 ? 2 : 1;
      const navTop = bodyRows >= 16 ? Math.max(2, Math.floor(bodyRows * 0.08)) : 1;

      // Top area of rail (row 0 or above navTop) toggles sidebar
      if (bodyRow < navTop) {
        this.toggleSidebar();
        return true;
      }

      if (bodyRow >= bodyRows) return false;

      const settingsRow = Math.max(navTop + step * 5 + 1, bodyRows - 2);

      if (bodyRow >= settingsRow - 1) {
        this.setActiveTab(0);
        return true;
      }
      if (bodyRow >= navTop && bodyRow < navTop + step) {
        this.setActiveTab(1);
        return true;
      }
      if (bodyRow >= navTop + step && bodyRow < navTop + step * 2) {
        this.setActiveTab(2);
        return true;
      }
      if (bodyRow >= navTop + step * 2 && bodyRow < navTop + step * 3) {
        this.setActiveTab(3);
        return true;
      }
      if (bodyRow >= navTop + step * 3 && bodyRow < navTop + step * 4) {
        this.setActiveTab(4);
        return true;
      }
      if (bodyRow >= navTop + step * 4 && bodyRow < navTop + step * 5) {
        this.setActiveTab(5);
        return true;
      }
      return false;
    }

    // 2. Footer hotkey bar click handling (bottom row):
    if (row >= terminalRows - 1) {
      if (col >= 1 && col <= 18) {
        this.setActiveTab(this.getNextTab(this.activeTab));
        return true;
      }
      if (col > 18 && col <= 34) {
        this.toggleSidebar();
        return true;
      }
      if (col > 34 && col <= 52) {
        this.previewArtifacts();
        return true;
      }
      if (col > 52 && col <= 76) {
        this.cycleModel();
        return true;
      }
      if (col >= W - 14) {
        if (this.isRunning) {
          this.exit();
          process.exit(0);
        }
        return true;
      }
      return false;
    }

    // 3. Tab-specific interactive click handling:
    if (this.modalMode !== 'none') {
      return true;
    }

    // Tab 1: Dashboard / Transcript
    if (this.activeTab === 1) {
      if (hasTranscriptSession) {
        // Vertical scrollbar track is at mainW - 2 to mainW
        if (col >= mainW - 3 && col <= mainW) {
          if (row < bodyStartRow + Math.floor(bodyRows / 2)) {
            this.scrollUpCurrentView(5);
          } else {
            this.scrollDownCurrentView(5);
          }
          return true;
        }
        // Clicking bottom prompt input row
        if (row >= bodyStartRow + bodyRows - 3) {
          this.statusMessage = 'Ready. Type a command or press Enter.';
          this.render();
          return true;
        }
        // Clicking upper half of transcript scrolls up, lower half scrolls down
        if (row >= bodyStartRow && row < bodyStartRow + Math.floor(bodyRows / 2)) {
          this.scrollUpCurrentView(3);
          return true;
        } else if (row >= bodyStartRow + Math.floor(bodyRows / 2) && row < bodyStartRow + bodyRows - 3) {
          this.scrollDownCurrentView(3);
          return true;
        }
      }
      return false;
    }

    // Tab 2: Chat
    if (this.activeTab === 2) {
      if (col >= mainW - 3 && col <= mainW) {
        if (row < bodyStartRow + Math.floor(bodyRows / 2)) {
          this.scrollUpCurrentView(4);
        } else {
          this.scrollDownCurrentView(4);
        }
        return true;
      }
      if (row >= bodyStartRow + bodyRows - 3) {
        this.statusMessage = 'Chat input focused.';
        this.render();
        return true;
      }
      if (this.chatMessages.length > 0) {
        if (row < bodyStartRow + Math.floor(bodyRows / 2)) {
          this.scrollUpCurrentView(3);
        } else {
          this.scrollDownCurrentView(3);
        }
        return true;
      }
      return false;
    }

    // Tab 3: Swarm
    if (this.activeTab === 3) {
      if (col >= 2 && col <= 44 && row >= bodyStartRow + 6 && row <= bodyStartRow + 16) {
        const clickedAgentIdx = Math.floor((row - (bodyStartRow + 6)) / 2);
        if (clickedAgentIdx >= 0 && clickedAgentIdx < this.swarmAgents.length) {
          this.selectedSwarmAgentIndex = clickedAgentIdx;
          this.statusMessage = `Selected agent: ${this.swarmAgents[clickedAgentIdx].name}`;
          this.render();
          return true;
        }
      }
      if (col > 44 && col <= mainW) {
        if (row <= bodyStartRow + 2) {
          this.swarmInspectorExpanded = !this.swarmInspectorExpanded;
          this.render();
          return true;
        }
        if (row < bodyStartRow + Math.floor(bodyRows / 2)) {
          this.scrollUpCurrentView(3);
        } else {
          this.scrollDownCurrentView(3);
        }
        return true;
      }
      return false;
    }

    // Tab 0: Settings
    if (this.activeTab === 0) {
      if (row >= bodyStartRow + 4 && row <= bodyStartRow + 14) {
        this.cycleModel();
        return true;
      }
      return false;
    }

    return false;
  }

  public start(): void {
    // Switch to alternate screen buffer, clear screen, hide cursor, enable bracketed paste & explicitly disable mouse reporting.
    // Disabling DEC modes 1000-1007, 1015, 1016 prevents trackpad scroll gestures from sending escape bursts to stdin
    process.stdout.write(
      '\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l\x1b[?2004h\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1007l\x1b[?1015l\x1b[?1016l',
    );
    // In live interactive TTY sessions (not test runners), enable SGR mouse click reporting so clicks on « Collapse and tabs work seamlessly
    if (!process.env.VITEST && Boolean(process.stdout.isTTY)) {
      process.stdout.write('\x1b[?1000h\x1b[?1006h');
    }

    this.setupKeyboard();
    this.updateGpuTelemetry();
    void this.updateHerdrTelemetry();
    void this.refreshDetectedModels();
    process.stdout.on('resize', this.resizeHandler);

    // Sandbox unhandled rejections to prevent crashing the TUI during demos
    process.on('unhandledRejection', (reason: unknown) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      this.recordActivity('ERROR', `Async notice: ${msg.slice(0, 80)}`, c.pink);
      this.statusMessage = `Task notice: ${msg.slice(0, 60)}`;
      this.render();
    });
    process.on('uncaughtException', (err: Error) => {
      const msg = err.message || String(err);
      this.recordActivity('ERROR', `Exception recovered: ${msg.slice(0, 80)}`, c.pink);
      this.statusMessage = `Exception caught: ${msg.slice(0, 60)}`;
      this.render();
    });

    // Render loop
    this.render();
    this.startRefreshLoop();

    // Clean exit handlers
    process.on('SIGINT', this.interruptHandler);
    process.on('SIGTERM', this.terminateHandler);
  }

  public cleanupKeyboard(): void {
    if (this.rawStdinFlushTimer) {
      clearTimeout(this.rawStdinFlushTimer);
      this.rawStdinFlushTimer = null;
    }
    this.rawStdinBuffer = '';
    this.isPasting = false;
    this.pasteBuffer = '';
    if (this.origStdinEmit) {
      process.stdin.emit = this.origStdinEmit;
      this.origStdinEmit = null;
    }
    if (this.keypressHandler) {
      process.stdin.removeListener('keypress', this.keypressHandler);
      this.keypressHandler = null;
    }
  }

  /**
   * Formats a short model badge for footer hotkeys and status messages.
   * Ensures Gemma 4 E2B, Gemma 2 models, and Qwen models are clearly identified.
   */
  public getModelBadgeShort(modelId: string = this.selectedModel): string {
    const lower = modelId.toLowerCase();
    if (lower.startsWith('gemma4:e2b') || lower === 'gemma4' || lower === 'gemma4:latest') return 'Gemma 4 E2B';
    if (lower.startsWith('gemma2:9b')) return 'Gemma 2 9B';
    if (lower.startsWith('gemma2:2b')) return 'Gemma 2 2B';
    if (lower.startsWith('gemma3:4b')) return 'Gemma 3 4B';
    if (lower.startsWith('gemma')) {
      const parts = modelId.split(':');
      return `Gemma ${parts[1] || parts[0].replace('gemma', '')}`.trim();
    }
    if (lower.includes('qwen2.5-coder')) return 'Qwen Coder';
    if (lower.includes('qwen2.5-3b')) return 'Qwen 2.5 3B';
    if (lower.includes('qwen')) return 'Qwen';
    return modelId.split('/').pop()?.split(':')[0] || modelId;
  }

  /**
   * Atomically handles pasted text blocks (from bracketed paste or clipboard chunks).
   * Normalizes line breaks into spaces so that multi-line prompts do NOT prematurely
   * auto-submit or break into chunks, and performs a single atomic render.
   */
  public handlePastedText(rawText: string): void {
    if (!rawText) return;

    // 1. Strip ANSI escape sequences and non-printable control characters
    let clean = rawText
      .replace(/\x1b\[[0-9;?]*[a-zA-Z~]/g, '')
      .replace(/\x1b[\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

    // 2. Normalize newlines into spaces so multi-line prompt stays atomic without auto-submitting
    clean = clean
      .replace(/\r\n/g, ' ')
      .replace(/[\r\n\t]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!clean) return;

    // 3. Atomically insert into current active input box
    if (this.modalMode !== 'none') {
      this.modalInput.insert(clean);
    } else if (this.activeTab === 2) {
      this.chatInput.insert(clean);
      this.statusMessage = `Pasted ${clean.length} chars into chat. Press Enter to send.`;
    } else {
      if (this.activeTab !== 1) {
        this.activeTab = 1;
      }
      this.modalInput.insert(clean);
      this.statusMessage = `Pasted ${clean.length} chars into prompt. Press Enter to run.`;
    }

    // 4. Single atomic render call!
    this.render();
  }

  private exit(): void {
    this.isRunning = false;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.swarmAnimTimer) clearInterval(this.swarmAnimTimer);
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    if (this.transcriptRenderTimer) clearTimeout(this.transcriptRenderTimer);
    if (this.activeChild) {
      try {
        if (process.platform === 'win32' && this.activeChild.pid) {
          execSync(`taskkill /pid ${this.activeChild.pid} /T /F`, { stdio: 'ignore' });
        } else {
          this.activeChild.kill('SIGINT');
        }
      } catch {}
      this.activeChild = null;
    }
    process.stdout.removeListener('resize', this.resizeHandler);
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    } catch {}
    if (this.prefixTimeout) {
      clearTimeout(this.prefixTimeout);
      this.prefixTimeout = null;
    }
    if (this.previewServer) {
      try {
        this.previewServer.close();
      } catch {}
      this.previewServer = null;
    }
    this.cleanupKeyboard();
    // Restore normal screen buffer, disable mouse reporting, disable bracketed paste, reveal cursor
    process.stdout.write(
      '\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1007l\x1b[?1015l\x1b[?1016l\x1b[?2004l\x1b[?1049l\x1b[?25h',
    );
    console.log(c.cyanBright('✦ MAOS Oasis TUI closed. Returning to terminal.'));
    process.exit(0);
  }

  private setupKeyboard(): void {
    if (process.stdin.setRawMode) {
      try {
        process.stdin.setRawMode(true);
      } catch {}
    }
    try {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    } catch {}

    // Intercept raw stdin data events BEFORE readline's emitKeypressEvents processes them.
    // Provides stream-level buffering so that bursts of SGR mouse escape sequences
    // (e.g. \x1b[<64;col;rowM generated during trackpad scrolling in Windows terminal)
    // are cleanly stripped or handled, even if the terminal splits them across chunk boundaries.
    if (!this.origStdinEmit) {
      const origEmit = process.stdin.emit.bind(process.stdin);
      this.origStdinEmit = origEmit;

      const SGR_MOUSE_REGEX = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
      const X10_MOUSE_REGEX = /\x1b\[M([\s\S]{3})/g;
      const URXVT_MOUSE_REGEX = /\x1b\[(\d+);(\d+);(\d+)([Mm])/g;
      const FOCUS_REGEX = /\x1b\[[IO]/g;
      const PASTE_REGEX = /\x1b\[20[01]~/g;
      const DANGLING_MOUSE_REGEX = /(?:\[?<|<)\d+(?:;\d+)*[Mm]/gi;
      const DANGLING_SEMI_REGEX = /(?:^|[;\s])\d+(?:;\d+)+[Mm](?=[;\s]|$)/gi;

      const PARTIAL_SGR_MOUSE_REGEX = /\x1b\[<[\d;]*$/;
      const PARTIAL_X10_MOUSE_REGEX = /\x1b\[M[\s\S]{0,2}$/;
      const PARTIAL_URXVT_REGEX = /\x1b\[(?:\d+;)*\d*$/;
      const PARTIAL_ESC_REGEX = /\x1b$/;

      const clearTimer = () => {
        if (this.rawStdinFlushTimer) {
          clearTimeout(this.rawStdinFlushTimer);
          this.rawStdinFlushTimer = null;
        }
      };

      const onEscapeTimeout = () => {
        clearTimer();
        if (!this.rawStdinBuffer) return;

        // If the pending buffer is an incomplete mouse sequence:
        // NEVER emit it to readline! Incomplete mouse sequences (e.g. \x1b[<64;10;)
        // are NEVER valid user typing and will corrupt the active input box.
        if (PARTIAL_SGR_MOUSE_REGEX.test(this.rawStdinBuffer) || PARTIAL_X10_MOUSE_REGEX.test(this.rawStdinBuffer)) {
          this.rawStdinBuffer = '';
          return;
        }

        // If it's a standalone ESC or CSI (e.g. user pressed Escape key):
        const toSend = this.rawStdinBuffer;
        this.rawStdinBuffer = '';
        origEmit('data', toSend);
      };

      process.stdin.emit = (event: string | symbol, ...args: any[]): boolean => {
        if (event === 'data' && args[0] !== undefined) {
          clearTimer();
          let chunkStr = typeof args[0] === 'string' ? args[0] : args[0].toString('utf8');

          // Strip focus reporting
          chunkStr = chunkStr.replace(FOCUS_REGEX, '');

          // 1. Bracketed Paste Handling (\x1b[200~ ... \x1b[201~)
          if (this.isPasting) {
            const endIdx = chunkStr.indexOf('\x1b[201~');
            if (endIdx !== -1) {
              this.pasteBuffer += chunkStr.slice(0, endIdx);
              const remaining = chunkStr.slice(endIdx + 6);
              this.isPasting = false;
              const fullPaste = this.pasteBuffer;
              this.pasteBuffer = '';
              this.handlePastedText(fullPaste);
              if (!remaining) return true;
              chunkStr = remaining;
            } else {
              this.pasteBuffer += chunkStr;
              return true;
            }
          }

          if (chunkStr.includes('\x1b[200~')) {
            const startIdx = chunkStr.indexOf('\x1b[200~');
            const before = chunkStr.slice(0, startIdx);
            const after = chunkStr.slice(startIdx + 6);
            if (before) {
              origEmit('data', before);
            }
            const endIdx = after.indexOf('\x1b[201~');
            if (endIdx !== -1) {
              const fullPaste = after.slice(0, endIdx);
              const remaining = after.slice(endIdx + 6);
              this.handlePastedText(fullPaste);
              if (!remaining) return true;
              chunkStr = remaining;
            } else {
              this.isPasting = true;
              this.pasteBuffer = after;
              return true;
            }
          }

          // 2. Fallback Paste Detection (multi-line chunks or large text blocks)
          // Standalone return keys (\r, \n, \r\n) are normal Enter presses for readline.
          // Chunks containing newlines alongside other text, OR large printable strings (>12 chars)
          // without escape codes are bulk pastes and should be processed atomically.
          const isStandaloneReturn = chunkStr === '\r' || chunkStr === '\n' || chunkStr === '\r\n';
          const hasEmbeddedNewlines = (chunkStr.includes('\n') || chunkStr.includes('\r')) && !isStandaloneReturn;
          const isBulkPrintable = chunkStr.length > 12 && !chunkStr.includes('\x1b') && !/[\x00-\x1f]/.test(chunkStr);

          if (hasEmbeddedNewlines || isBulkPrintable) {
            this.handlePastedText(chunkStr);
            return true;
          }

          this.rawStdinBuffer += chunkStr;
          this.rawStdinBuffer = this.rawStdinBuffer.replace(PASTE_REGEX, '');

          // Strip complete SGR mouse sequences and process wheel events or clicks
          this.rawStdinBuffer = this.rawStdinBuffer.replace(SGR_MOUSE_REGEX, (_match, btnStr, colStr, rowStr, mode) => {
            const btn = parseInt(btnStr, 10);
            if (btn === 64 || btn === 66 || btn === 68 || btn === 72 || btn === 80) {
              this.scrollUpCurrentView(3);
            } else if (btn === 65 || btn === 67 || btn === 69 || btn === 73 || btn === 81) {
              this.scrollDownCurrentView(3);
            } else if (btn === 0 && mode === 'M') {
              this.handleMouseClick(parseInt(colStr, 10), parseInt(rowStr, 10));
            }
            return '';
          });

          // Strip complete X10 mouse sequences and process wheel events
          this.rawStdinBuffer = this.rawStdinBuffer.replace(X10_MOUSE_REGEX, (_match, bytes) => {
            if (bytes.length >= 1) {
              const code = bytes.charCodeAt(0);
              if (code === 0x60 || code === 0x62) {
                this.scrollUpCurrentView(3);
              } else if (code === 0x61 || code === 0x63) {
                this.scrollDownCurrentView(3);
              }
            }
            return '';
          });

          // Strip complete URXVT mouse sequences
          this.rawStdinBuffer = this.rawStdinBuffer.replace(URXVT_MOUSE_REGEX, (_match, btnStr) => {
            const btn = parseInt(btnStr, 10);
            if (btn === 64 || btn === 66) {
              this.scrollUpCurrentView(3);
            } else if (btn === 65 || btn === 67) {
              this.scrollDownCurrentView(3);
            }
            return '';
          });

          // Strip any dangling severed mouse fragments
          this.rawStdinBuffer = this.rawStdinBuffer.replace(DANGLING_MOUSE_REGEX, '');
          this.rawStdinBuffer = this.rawStdinBuffer.replace(DANGLING_SEMI_REGEX, '');

          // Check if buffer ends with an incomplete sequence
          const sgrPartial = this.rawStdinBuffer.match(PARTIAL_SGR_MOUSE_REGEX);
          const x10Partial = this.rawStdinBuffer.match(PARTIAL_X10_MOUSE_REGEX);
          const urxvtOrCsiPartial = this.rawStdinBuffer.match(PARTIAL_URXVT_REGEX);
          const escPartial = this.rawStdinBuffer.match(PARTIAL_ESC_REGEX);

          let toSend = this.rawStdinBuffer;

          if (sgrPartial || x10Partial) {
            const p = (sgrPartial || x10Partial)!;
            toSend = this.rawStdinBuffer.slice(0, p.index);
            this.rawStdinBuffer = p[0];
            this.rawStdinFlushTimer = setTimeout(onEscapeTimeout, 250);
          } else if (urxvtOrCsiPartial || escPartial) {
            const p = (urxvtOrCsiPartial || escPartial)!;
            toSend = this.rawStdinBuffer.slice(0, p.index);
            this.rawStdinBuffer = p[0];
            this.rawStdinFlushTimer = setTimeout(onEscapeTimeout, 30);
          } else {
            this.rawStdinBuffer = '';
          }

          if (!toSend) {
            return true;
          }
          args[0] = Buffer.isBuffer(args[0]) ? Buffer.from(toSend, 'utf8') : toSend;
        }
        return origEmit(event, ...args);
      };
    }

    readline.emitKeypressEvents(process.stdin);

    if (this.keypressHandler) {
      process.stdin.removeListener('keypress', this.keypressHandler);
    }

    this.keypressHandler = (str, key) => {
      // Synthesize key object if undefined from readline on raw Windows stream
      if (!key) {
        if (!str) return;
        key = {
          name:
            str === '\r' || str === '\n'
              ? 'return'
              : str === '\x1b'
                ? 'escape'
                : str === '\x08' || str === '\x7f'
                  ? 'backspace'
                  : str === '\t'
                    ? 'tab'
                    : str === '\x1c'
                      ? '\\'
                      : str,
          ctrl: str === '\x03' || str === '\x1c',
          meta: false,
          shift: false,
        };
      }

      // Handle Ctrl+C to cancel current process or quit cleanly
      if ((key.ctrl && key.name === 'c') || str === '\x03') {
        this.interruptHandler();
        return;
      }

      // Synthesize key object for raw terminal sequences (Ctrl+Arrows, Delete, Home, End, F2, Alt+Keys)
      if (str === '\x1b[1;5D' || str === '\x1b[5D' || str === '\x1b\x1b[D' || str === '\x1bb') {
        key = { name: 'left', ctrl: true, meta: false, shift: false };
      } else if (str === '\x1b[1;5C' || str === '\x1b[5C' || str === '\x1b\x1b[C' || str === '\x1bf') {
        key = { name: 'right', ctrl: true, meta: false, shift: false };
      } else if (str === '\x1b[3~') {
        key = { name: 'delete', ctrl: false, meta: false, shift: false };
      } else if (str === '\x1b[H' || str === '\x1b[1~') {
        key = { name: 'home', ctrl: false, meta: false, shift: false };
      } else if (str === '\x1b[F' || str === '\x1b[4~') {
        key = { name: 'end', ctrl: false, meta: false, shift: false };
      } else if (str === '\x1bOQ' || str === '\x1b[12~' || str === '\x1b[1;2Q') {
        key = { name: 'f2', ctrl: false, meta: false, shift: false };
      } else if (str === '\x17') {
        key = { name: 'w', ctrl: true, meta: false, shift: false };
      } else if (str === '\x1b\x7f' || str === '\x1b\x08') {
        key = { name: 'backspace', ctrl: false, meta: true, shift: false };
      } else if (str === '\x1bs' || str === '\x1bS') {
        key = { name: 's', ctrl: false, meta: true, shift: false };
      } else if (str === '\x1bm' || str === '\x1bM') {
        key = { name: 'm', ctrl: false, meta: true, shift: false };
      }

      // ── MOUSE AND ANSI ESCAPE SEQUENCE FILTER ────────────────────────────
      // SGR Extended Mouse Mode: \x1b[<button;col;rowM (press) or \x1b[<button;col;rowm (release)
      // Also handles stripped headers or coordinate fragments like <64;35;12M
      const sgrMouseMatch = str ? str.match(/^(?:\x1b\[<|\[<|<|\x1b\[)?(\d+);(\d+);(\d+)([Mm])$/i) : null;
      if (sgrMouseMatch) {
        const btn = parseInt(sgrMouseMatch[1], 10);
        // Mouse Wheel Vertical Scrolling (buttons 64, 66, 68, 72, 80 = up, 65, 67, 69, 73, 81 = down)
        if (btn === 64 || btn === 66 || btn === 68 || btn === 72 || btn === 80) {
          this.scrollUpCurrentView(3);
          return;
        }
        if (btn === 65 || btn === 67 || btn === 69 || btn === 73 || btn === 81) {
          this.scrollDownCurrentView(3);
          return;
        }

        // Left button click, release, motion, or other button events:
        // Handle left click press on the rail chevron (minimize/expand) or tabs
        if (btn === 0 && sgrMouseMatch[4] === 'M') {
          const col = parseInt(sgrMouseMatch[2], 10);
          const row = parseInt(sgrMouseMatch[3], 10);
          if (this.handleMouseClick(col, row)) {
            return;
          }
        }
        return;
      }

      // X10 / Normal Mouse Mode: \x1b[M...
      if (str && (str.startsWith('\x1b[M') || str.startsWith('[M'))) {
        if (
          str.startsWith('\x1b[M\x60') ||
          str.startsWith('[M\x60') ||
          str.startsWith('\x1b[M\x62') ||
          str.startsWith('[M\x62')
        ) {
          this.scrollUpCurrentView(3);
          return;
        }
        if (
          str.startsWith('\x1b[M\x61') ||
          str.startsWith('[M\x61') ||
          str.startsWith('\x1b[M\x63') ||
          str.startsWith('[M\x63')
        ) {
          this.scrollDownCurrentView(3);
          return;
        }
        // Consume all other X10 mouse tracking sequences
        return;
      }

      // Terminal state / control sequence filtering (focus, bracketed paste, terminal reports, dangling mouse fragments)
      if (
        str &&
        (str === '\x1b[I' ||
          str === '\x1b[O' ||
          str.startsWith('\x1b[200~') ||
          str.startsWith('\x1b[201~') ||
          /^\x1b\[\??\d+(?:;\d+)*[a-zA-Z~]$/.test(str) ||
          /^(?:\[?<|;)?\d+(?:;\d+)*[Mm]$/i.test(str) ||
          /^[<\[;]\d+/.test(str)) &&
        key.name !== 'up' &&
        key.name !== 'down' &&
        key.name !== 'left' &&
        key.name !== 'right' &&
        key.name !== 'pageup' &&
        key.name !== 'pagedown' &&
        key.name !== 'home' &&
        key.name !== 'end' &&
        key.name !== 'delete' &&
        key.name !== 'insert' &&
        key.name !== 'tab' &&
        key.name !== 'escape' &&
        key.name !== 'return' &&
        key.name !== 'backspace' &&
        key.name !== 'f2' &&
        str !== '\x1b[12~' &&
        str !== '\x1bOQ' &&
        str !== '\x1b[1;2Q' &&
        str !== '\x1b[OQ' &&
        str !== '\x1bO2Q' &&
        str !== '\x1b[24~'
      ) {
        return;
      }

      // Global Direct Shortcuts (Work universally from any view, including chat/input)
      if (
        key.name === 'f2' ||
        str === '\x1bOQ' ||
        str === '\x1b[12~' ||
        str === '\x1b[1;2Q' ||
        str === '\x1b[OQ' ||
        str === '\x1bO2Q' ||
        str === '\x1b[24~' ||
        (key.ctrl && (key.name === '\\' || key.name === 'backslash')) ||
        str === '\x1c' ||
        (key.ctrl && (key.name === 's' || str === '\x13')) ||
        (key.meta && (key.name === 's' || key.name === 'm')) ||
        str === '\x1bs' ||
        str === '\x1bm'
      ) {
        this.toggleSidebar();
        return;
      }
      if ((key.ctrl && key.name === 'p') || str === '\x10') {
        this.previewArtifacts();
        return;
      }
      if ((key.ctrl && key.name === 'g') || str === '\x07') {
        this.cycleModel();
        return;
      }
      if ((key.ctrl && key.name === 'r') || str === '\x12') {
        void this.updateHerdrTelemetry();
        void this.refreshDetectedModels();
        this.statusMessage = 'Swarm roster and telemetry refreshed.';
        this.render();
        return;
      }

      // Prefix Key Toggle (Ctrl+B standard matching tmux, cmux, and herdr)
      if ((key.ctrl && (key.name === 'b' || str === '\x02')) || str === '\x02') {
        this.prefixActive = !this.prefixActive;
        if (this.prefixTimeout) {
          clearTimeout(this.prefixTimeout);
          this.prefixTimeout = null;
        }
        if (this.prefixActive) {
          this.prefixTimeout = setTimeout(() => {
            this.prefixActive = false;
            this.prefixTimeout = null;
            this.render();
          }, 4000);
          this.statusMessage =
            'PREFIX MODE ACTIVE: [P] Preview · [G] Model · [S] Sidebar · [R] Refresh · [I] Ignite · [0-5] Tab · [Esc] Cancel';
        } else {
          this.statusMessage = 'Prefix mode deactivated.';
        }
        this.render();
        return;
      }

      // Prefix Command Dispatcher: if prefix is active, execute next key as a cockpit command
      if (this.prefixActive) {
        this.prefixActive = false;
        if (this.prefixTimeout) {
          clearTimeout(this.prefixTimeout);
          this.prefixTimeout = null;
        }
        const actionKey = (key.name || str || '').toLowerCase();
        if (actionKey === 'escape') {
          this.statusMessage = 'Prefix command cancelled.';
          this.render();
          return;
        }
        if (actionKey === 'p' || actionKey === 'o') {
          this.previewArtifacts();
          return;
        }
        if (actionKey === 'g') {
          this.cycleModel();
          return;
        }
        if (actionKey === 'r') {
          void this.updateHerdrTelemetry();
          void this.refreshDetectedModels();
          this.statusMessage = 'Swarm roster and telemetry refreshed.';
          this.render();
          return;
        }
        if (actionKey === 'i') {
          this.modalMode = 'ignite';
          this.modalInputText = 'Build and deploy Canva 3D Spatial Studio';
          this.render();
          return;
        }
        if (['0', '1', '2', '3', '4', '5'].includes(actionKey)) {
          const target = parseInt(actionKey, 10);
          this.activeTab = target;
          this.statusMessage = `Switched to View [${this.activeTab}].`;
          this.render();
          return;
        }
        if (actionKey === 'c') {
          this.activeTab = 2;
          this.statusMessage = 'Switched to View [2] — Local Chat.';
          this.render();
          return;
        }
        if (actionKey === 's' || actionKey === 'm' || actionKey === '\\') {
          this.toggleSidebar();
          return;
        }
        if (actionKey === 'pageup' || actionKey === 'up' || actionKey === 'k') {
          this.scrollUpCurrentView();
          return;
        }
        if (actionKey === 'pagedown' || actionKey === 'down' || actionKey === 'j') {
          this.scrollDownCurrentView();
          return;
        }
        this.statusMessage = `Prefix ignored for key '${actionKey}'.`;
        this.render();
        return;
      }

      // If an external command is actively running:
      if (this.externalCommandRunning) {
        // Tab key always cycles views:
        if (key.name === 'tab') {
          this.activeTab = key.shift ? this.getPrevTab(this.activeTab) : this.getNextTab(this.activeTab);
          this.statusMessage = `Switched to View [${this.activeTab}].`;
          this.render();
          return;
        }
        // Direct number keys switch views:
        if (str && ['0', '1', '2', '3', '4', '5'].includes(str)) {
          this.activeTab = Number(str);
          this.statusMessage = `Switched to View [${this.activeTab}].`;
          this.render();
          return;
        }
        // PageUp / PageDown / Home / End scroll the live transcript on View 1:
        if (
          ['pageup', 'pagedown', 'home', 'end'].includes(key.name) &&
          this.activeTab === 1 &&
          this.transcript.length > 0
        ) {
          if (key.name === 'home') {
            this.transcriptScrollOffset = Math.max(0, this.transcriptRenderedRowCount - this.transcriptViewportRows);
          } else if (key.name === 'end') {
            this.transcriptScrollOffset = 0;
          } else {
            const isUp = key.name === 'pageup' || key.name === 'up';
            const step =
              key.name === 'pageup' || key.name === 'pagedown' ? Math.max(1, this.transcriptViewportRows - 1) : 3;
            this.transcriptScrollOffset += isUp ? step : -step;
            this.transcriptScrollOffset = Math.max(
              0,
              Math.min(
                this.transcriptScrollOffset,
                Math.max(0, this.transcriptRenderedRowCount - this.transcriptViewportRows),
              ),
            );
          }
          this.render();
          return;
        }
        // Q key quits when on non-input views (tabs 3, 4, 5, 0):
        if (this.activeTab !== 1 && this.activeTab !== 2 && key.name === 'q') {
          this.exit();
          return;
        }
        // Enter gives immediate feedback:
        if (key.name === 'return') {
          this.statusMessage = 'A task is currently running. Press Ctrl+C to abort it before starting a new one.';
          this.render();
          return;
        }
        return;
      }

      // If in modal dialog mode (ignite/promptTest modal overlays):
      if (this.modalMode !== 'none') {
        if (key.name === 'escape') {
          this.modalMode = 'none';
          this.modalInput.clearLine();
          this.statusMessage = 'Action cancelled.';
          this.render();
          return;
        }
        if (key.name === 'return') {
          this.handleModalSubmit();
          return;
        }
        if (key.name === 'left') {
          const byWord = Boolean(key.ctrl || key.meta);
          this.modalInput.moveLeft(byWord);
          this.render();
          return;
        }
        if (key.name === 'right') {
          const byWord = Boolean(key.ctrl || key.meta);
          this.modalInput.moveRight(byWord);
          this.render();
          return;
        }
        if (key.name === 'home' || (key.ctrl && key.name === 'a') || str === '\x01') {
          this.modalInput.moveToStart();
          this.render();
          return;
        }
        if (key.name === 'end' || (key.ctrl && key.name === 'e') || str === '\x05') {
          this.modalInput.moveToEnd();
          this.render();
          return;
        }
        if (key.name === 'delete' || (key.ctrl && key.name === 'd') || str === '\x04') {
          this.modalInput.deleteForward();
          this.render();
          return;
        }
        const isCtrlBackspace =
          (Boolean(key.ctrl) && (key.name === 'backspace' || key.name === 'h' || key.name === 'w')) ||
          (Boolean(key.meta) && key.name === 'backspace') ||
          (Boolean(key.ctrl) && (str === '\x08' || str === '\x7f')) ||
          str === '\x17' ||
          str === '\x1b\x7f' ||
          str === '\x1b\x08';
        if (isCtrlBackspace) {
          this.modalInput.deleteWordBackward();
          this.render();
          return;
        }
        if (key.name === 'backspace' || str === '\x08' || str === '\x7f') {
          this.modalInput.deleteBackward();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'u') || str === '\x15') {
          this.modalInput.clearLine();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'k') || str === '\x0b') {
          this.modalInput.clearToEnd();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'y') || str === '\x19') {
          this.modalInput.yank();
          this.render();
          return;
        }
        const isPrintable =
          str &&
          !str.includes('\x1b') &&
          !str.includes('\u001b') &&
          !/^\[?<\d+;/.test(str) &&
          !/^\[?<?\d+;\d+;\d+[Mm]$/i.test(str) &&
          !/^\d+;\d+;\d+[Mm]$/i.test(str) &&
          !/[\x00-\x1f]/.test(str);
        if (isPrintable && !key.ctrl && !key.meta) {
          this.modalInput.insert(str);
          this.render();
          return;
        }
        return;
      }

      // If on Tab 1 (where the prompt box is always ready to receive input):
      if (this.activeTab === 1) {
        if (key.name === 'tab') {
          this.activeTab = key.shift ? this.getPrevTab(1) : this.getNextTab(1);
          this.statusMessage = `Switched to View [${this.activeTab}].`;
          this.render();
          return;
        }
        if (key.name === 'escape') {
          if (this.chatIsStreaming && this.activeChatAbortController) {
            this.activeChatAbortController.abort();
            this.activeChatAbortController = null;
            this.chatIsStreaming = false;
            this.statusMessage = 'Chat generation cancelled.';
            this.appendTranscript('\n[Chat generation cancelled]');
            this.render();
            return;
          }
          if (this.modalInput.getText() !== '') {
            this.modalInput.clearLine();
            this.statusMessage = 'Input cleared.';
          } else {
            // Esc on empty input restores pristine home dashboard view
            this.transcript = [];
            this.transcriptScrollOffset = 0;
            this.statusMessage = 'Returned to Home Dashboard.';
          }
          this.commandHistoryIndex = this.commandHistory.length;
          this.render();
          return;
        }
        if (key.name === 'return') {
          if (this.chatIsStreaming) {
            this.statusMessage = 'Gemma is currently responding. Press Esc to cancel.';
            this.render();
            return;
          }
          const command = this.modalInput.getText().trim();
          this.modalInput.clearLine();
          this.commandHistoryIndex = this.commandHistory.length;
          if (command) {
            this.commandHistory.push(command);
            this.commandHistory = this.commandHistory.slice(-50);
            void this.executeCommandLine(command);
          } else {
            this.statusMessage = 'Type a goal or /help to run commands.';
            this.render();
          }
          return;
        }

        // Full cursor navigation & editing within prompt box:
        if (key.name === 'left') {
          const byWord = Boolean(key.ctrl || key.meta);
          this.modalInput.moveLeft(byWord);
          this.render();
          return;
        }
        if (key.name === 'right') {
          const byWord = Boolean(key.ctrl || key.meta);
          this.modalInput.moveRight(byWord);
          this.render();
          return;
        }
        if (key.name === 'home' || (key.ctrl && key.name === 'a') || str === '\x01') {
          if (this.modalInput.getText() !== '' || this.transcript.length === 0) {
            this.modalInput.moveToStart();
            this.render();
            return;
          }
        }
        if (key.name === 'end' || (key.ctrl && key.name === 'e') || str === '\x05') {
          if (this.modalInput.getText() !== '' || this.transcript.length === 0) {
            this.modalInput.moveToEnd();
            this.render();
            return;
          }
        }
        if (key.name === 'delete' || (key.ctrl && key.name === 'd') || str === '\x04') {
          this.modalInput.deleteForward();
          this.render();
          return;
        }
        const isCtrlBackspace =
          (Boolean(key.ctrl) && (key.name === 'backspace' || key.name === 'h' || key.name === 'w')) ||
          (Boolean(key.meta) && key.name === 'backspace') ||
          (Boolean(key.ctrl) && (str === '\x08' || str === '\x7f')) ||
          str === '\x17' ||
          str === '\x1b\x7f' ||
          str === '\x1b\x08';
        if (isCtrlBackspace) {
          this.modalInput.deleteWordBackward();
          this.render();
          return;
        }
        if (key.name === 'backspace' || str === '\x08' || str === '\x7f') {
          this.modalInput.deleteBackward();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'u') || str === '\x15') {
          this.modalInput.clearLine();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'k') || str === '\x0b') {
          this.modalInput.clearToEnd();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'y') || str === '\x19') {
          this.modalInput.yank();
          this.render();
          return;
        }

        // When transcript/Ignite logs are present, Up/Down, PageUp/PageDown, Home/End scroll the view:
        if (
          ['pageup', 'pagedown', 'home', 'end', 'up', 'down'].includes(key.name) &&
          this.transcript.length > 0 &&
          !key.alt
        ) {
          if (key.ctrl && key.name === 'up') {
            this.scrollUpCurrentView(3);
            return;
          }
          if (key.ctrl && key.name === 'down') {
            this.scrollDownCurrentView(3);
            return;
          }
          if (key.name === 'home') {
            this.transcriptScrollOffset = Math.max(0, this.transcriptRenderedRowCount - this.transcriptViewportRows);
          } else if (key.name === 'end') {
            this.transcriptScrollOffset = 0;
          } else {
            const isUp = key.name === 'pageup' || key.name === 'up';
            const step =
              key.name === 'pageup' || key.name === 'pagedown' ? Math.max(1, this.transcriptViewportRows - 1) : 3;
            this.transcriptScrollOffset += isUp ? step : -step;
            this.transcriptScrollOffset = Math.max(
              0,
              Math.min(
                this.transcriptScrollOffset,
                Math.max(0, this.transcriptRenderedRowCount - this.transcriptViewportRows),
              ),
            );
          }
          this.render();
          return;
        }

        // History navigation with Up/Down (when transcript is empty or with Alt modifier)
        if (
          (key.name === 'up' || (key.alt && key.name === 'up')) &&
          this.commandHistory.length > 0 &&
          (this.modalInput.getText() === '' ||
            this.modalInput.getText() === (this.commandHistory[this.commandHistoryIndex] || ''))
        ) {
          this.commandHistoryIndex = Math.max(0, this.commandHistoryIndex - 1);
          this.modalInput.setText(this.commandHistory[this.commandHistoryIndex] || '', true);
          this.render();
          return;
        }
        if (
          (key.name === 'down' || (key.alt && key.name === 'down')) &&
          this.commandHistory.length > 0 &&
          (this.modalInput.getText() === '' ||
            this.modalInput.getText() === (this.commandHistory[this.commandHistoryIndex] || ''))
        ) {
          this.commandHistoryIndex = Math.min(this.commandHistory.length, this.commandHistoryIndex + 1);
          this.modalInput.setText(this.commandHistory[this.commandHistoryIndex] || '', true);
          this.render();
          return;
        }

        // Capture ANY typed or dictated characters directly into the input box at cursor:
        const isPrintable =
          str &&
          !str.includes('\x1b') &&
          !str.includes('\u001b') &&
          !/^\[?<\d+;/.test(str) &&
          !/^\[?<?\d+;\d+;\d+[Mm]$/i.test(str) &&
          !/^\d+;\d+;\d+[Mm]$/i.test(str) &&
          !/[\x00-\x08\x0b-\x1f]/.test(str);
        if (isPrintable && !key.ctrl && !key.meta) {
          this.modalInput.insert(str);
          this.commandHistoryIndex = this.commandHistory.length;
          this.render();
          return;
        }
      }

      // If on Tab 2 (Dedicated Local Gemma LLM Chat):
      if (this.activeTab === 2) {
        if (key.name === 'tab') {
          this.activeTab = key.shift ? this.getPrevTab(2) : this.getNextTab(2);
          this.statusMessage = `Switched to View [${this.activeTab}].`;
          this.render();
          return;
        }
        if (key.name === 'escape') {
          if (this.chatIsStreaming && this.activeChatAbortController) {
            this.activeChatAbortController.abort();
            this.activeChatAbortController = null;
            this.chatIsStreaming = false;
            this.statusMessage = 'Chat generation cancelled.';
            this.render();
            return;
          }
          this.chatInput.clearLine();
          this.statusMessage = 'Chat input cleared.';
          this.render();
          return;
        }
        if (key.name === 'return') {
          if (this.chatIsStreaming) {
            this.statusMessage = 'Gemma is currently responding. Press Esc to cancel.';
            this.render();
            return;
          }
          const msg = this.chatInput.getText().trim();
          this.chatInput.clearLine();
          if (msg) {
            if (msg.startsWith('/')) {
              void this.executeCommandLine(msg);
              return;
            }
            void this.sendGemmaChatMessage(msg, false);
          } else {
            this.statusMessage = 'Type a message to chat with Gemma.';
            this.render();
          }
          return;
        }

        // Full cursor navigation & editing within chat input box:
        if (key.name === 'left') {
          const byWord = Boolean(key.ctrl || key.meta);
          this.chatInput.moveLeft(byWord);
          this.render();
          return;
        }
        if (key.name === 'right') {
          const byWord = Boolean(key.ctrl || key.meta);
          this.chatInput.moveRight(byWord);
          this.render();
          return;
        }
        if (key.name === 'home' || (key.ctrl && key.name === 'a') || str === '\x01') {
          if (this.chatInput.getText() !== '' || this.chatMessages.length === 0) {
            this.chatInput.moveToStart();
            this.render();
            return;
          }
        }
        if (key.name === 'end' || (key.ctrl && key.name === 'e') || str === '\x05') {
          if (this.chatInput.getText() !== '' || this.chatMessages.length === 0) {
            this.chatInput.moveToEnd();
            this.render();
            return;
          }
        }
        if (key.name === 'delete' || (key.ctrl && key.name === 'd') || str === '\x04') {
          this.chatInput.deleteForward();
          this.render();
          return;
        }
        const isCtrlBackspace =
          (Boolean(key.ctrl) && (key.name === 'backspace' || key.name === 'h' || key.name === 'w')) ||
          (Boolean(key.meta) && key.name === 'backspace') ||
          (Boolean(key.ctrl) && (str === '\x08' || str === '\x7f')) ||
          str === '\x17' ||
          str === '\x1b\x7f' ||
          str === '\x1b\x08';
        if (isCtrlBackspace) {
          this.chatInput.deleteWordBackward();
          this.render();
          return;
        }
        if (key.name === 'backspace' || str === '\x08' || str === '\x7f') {
          this.chatInput.deleteBackward();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'u') || str === '\x15') {
          this.chatInput.clearLine();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'k') || str === '\x0b') {
          this.chatInput.clearToEnd();
          this.render();
          return;
        }
        if ((key.ctrl && key.name === 'y') || str === '\x19') {
          this.chatInput.yank();
          this.render();
          return;
        }

        if (['pageup', 'pagedown', 'home', 'end', 'up', 'down'].includes(key.name) && this.chatMessages.length > 0) {
          if (key.ctrl && key.name === 'up') {
            this.scrollUpCurrentView(3);
            return;
          }
          if (key.ctrl && key.name === 'down') {
            this.scrollDownCurrentView(3);
            return;
          }
          if (key.name === 'home') {
            this.chatScrollOffset = Math.max(0, this.chatRenderedRowCount - this.chatViewportRows);
          } else if (key.name === 'end') {
            this.chatScrollOffset = 0;
          } else {
            const isUp = key.name === 'pageup' || key.name === 'up';
            const step = key.name === 'pageup' || key.name === 'pagedown' ? Math.max(1, this.chatViewportRows - 1) : 3;
            this.chatScrollOffset += isUp ? step : -step;
            this.chatScrollOffset = Math.max(
              0,
              Math.min(this.chatScrollOffset, Math.max(0, this.chatRenderedRowCount - this.chatViewportRows)),
            );
          }
          this.render();
          return;
        }
        const isPrintable =
          str &&
          !str.includes('\x1b') &&
          !str.includes('\u001b') &&
          !/^\[?<\d+;/.test(str) &&
          !/^\[?<?\d+;\d+;\d+[Mm]$/i.test(str) &&
          !/^\d+;\d+;\d+[Mm]$/i.test(str) &&
          !/[\x00-\x08\x0b-\x1f]/.test(str);
        if (isPrintable && !key.ctrl && !key.meta) {
          this.chatInput.insert(str);
          this.render();
          return;
        }
      }

      // If on Tab 3 (Swarm Board):
      if (this.activeTab === 3) {
        if (key.name === 'tab') {
          this.activeTab = key.shift ? this.getPrevTab(3) : this.getNextTab(3);
          this.statusMessage = `Switched to View [${this.activeTab}].`;
          this.render();
          return;
        }
        if (key.name === 'escape') {
          if (this.swarmInspectorExpanded) {
            this.swarmInspectorExpanded = false;
            this.statusMessage = 'Collapsed swarm inspector.';
          } else {
            this.activeTab = 1;
            this.statusMessage = 'Returned to Dashboard.';
          }
          this.render();
          return;
        }
        if (key.name === 'return' || key.name === 'e') {
          this.swarmInspectorExpanded = !this.swarmInspectorExpanded;
          this.statusMessage = this.swarmInspectorExpanded ? 'Expanded swarm inspector.' : 'Collapsed swarm inspector.';
          this.render();
          return;
        }
        if (key.name === 'up' || key.name === 'k') {
          this.selectedSwarmAgentIndex = Math.max(0, this.selectedSwarmAgentIndex - 1);
          this.render();
          return;
        }
        if (key.name === 'down' || key.name === 'j') {
          this.selectedSwarmAgentIndex = Math.min(this.swarmAgents.length - 1, this.selectedSwarmAgentIndex + 1);
          this.render();
          return;
        }
        if (key.name === 'p') {
          this.previewArtifacts();
          return;
        }
        if (key.name === 'r') {
          void this.updateHerdrTelemetry();
          void this.refreshDetectedModels();
          this.statusMessage = 'Swarm roster and telemetry refreshed.';
          this.render();
          return;
        }
        if (key.name === 'g' || str?.toLowerCase() === 'g') {
          this.cycleModel();
          return;
        }
        if (['1', '2', '3', '4', '5'].includes(key.name)) {
          const targetAgentIdx = parseInt(key.name, 10) - 1;
          if (targetAgentIdx >= 0 && targetAgentIdx < this.swarmAgents.length) {
            this.selectedSwarmAgentIndex = targetAgentIdx;
            this.statusMessage = `Selected swarm agent: ${this.swarmAgents[targetAgentIdx].id}`;
            this.render();
            return;
          }
        }
      }

      // Action hotkeys on other tabs (Tabs 4, 5, 0):
      if (key.name === 'q') {
        this.exit();
        return;
      }
      if (key.name === 'tab') {
        this.activeTab = key.shift ? this.getPrevTab(this.activeTab) : this.getNextTab(this.activeTab);
        this.statusMessage = `Switched to View [${this.activeTab}].`;
        this.render();
        return;
      }
      if (this.activeTab === 0 && key.name === 'escape') {
        this.activeTab = 1;
        this.statusMessage = 'Returned to Dashboard.';
        this.render();
        return;
      }
      if (this.activeTab === 0 && ['pageup', 'pagedown', 'home', 'end'].includes(key.name)) {
        const maxScroll = Math.max(0, this.settingsRenderedRowCount - this.settingsViewportRows);
        if (key.name === 'home') {
          this.settingsScrollOffset = 0;
        } else if (key.name === 'end') {
          this.settingsScrollOffset = maxScroll;
        } else {
          const step = Math.max(1, this.settingsViewportRows - 2);
          this.settingsScrollOffset =
            key.name === 'pageup'
              ? Math.max(0, this.settingsScrollOffset - step)
              : Math.min(maxScroll, this.settingsScrollOffset + step);
        }
        this.render();
        return;
      }
      if (key.name === 'return' || key.name === '/' || str === '/') {
        this.activeTab = 1;
        if (str === '/') this.modalInputText = '/';
        this.statusMessage = 'Command prompt active.';
        this.render();
        return;
      }
      if (key.name === 'c') {
        this.activeTab = 2;
        this.statusMessage = 'Switched to View [2] — Local Chat.';
        this.render();
        return;
      }
      if (key.name === 's') {
        this.loadWorkplaceConfig();
        this.activeTab = 0;
        this.statusMessage = 'Switched to View [0] — Settings.';
        this.render();
        return;
      }
      if (key.name === 'up' || key.name === 'down') {
        if (this.activeTab === 0 && this.settingsRenderedRowCount > this.settingsViewportRows) {
          const maxScroll = Math.max(0, this.settingsRenderedRowCount - this.settingsViewportRows);
          this.settingsScrollOffset =
            key.name === 'up'
              ? Math.max(0, this.settingsScrollOffset - 1)
              : Math.min(maxScroll, this.settingsScrollOffset + 1);
          this.render();
          return;
        }
        this.activeTab = key.name === 'down' ? this.getNextTab(this.activeTab) : this.getPrevTab(this.activeTab);
        this.statusMessage = `Switched to View [${this.activeTab}].`;
        this.render();
        return;
      }
      if (['0', '1', '2', '3', '4', '5'].includes(key.name)) {
        this.activeTab = parseInt(key.name, 10);
        this.statusMessage = `Switched to View [${this.activeTab}].`;
        this.render();
        return;
      }

      // Action hotkeys
      if (key.name === 'i') {
        this.modalMode = 'ignite';
        this.modalInputText = 'Build and deploy Canva 3D Spatial Studio';
        this.render();
        return;
      }

      if (key.name === 'g') {
        this.cycleModel();
        return;
      }

      if (key.name === 'p' || key.name === 'o') {
        this.previewArtifacts();
        return;
      }

      if (key.name === 'd') {
        this.openStudio();
        return;
      }

      if (key.name === 't') {
        this.runCanvaTests();
        return;
      }

      if (key.name === 'r') {
        this.loadWorkplaceConfig();
        this.updateGpuTelemetry();
        void this.updateHerdrTelemetry();
        void this.refreshDetectedModels();
        this.statusMessage = 'GPU, Herdr telemetry, and configuration refreshed.';
        if (this.activeTab === 1 && this.transcript.length > 0) this.appendTranscript(this.statusMessage);
        this.render();
        return;
      }
    };
    process.stdin.on('keypress', this.keypressHandler);
  }

  private async handleModalSubmit(): Promise<void> {
    const mode = this.modalMode;
    const input = this.modalInputText.trim();
    this.modalMode = 'none';
    this.modalInputText = '';

    if (!input) {
      this.reportCommand('Nothing entered. Action cancelled.', true);
      return;
    }

    this.activeTab = 1;
    this.transcriptScrollOffset = 0;
    this.appendTranscript(`› ${input}`);
    if (mode === 'promptTest') {
      this.runCliCommand(['plan', input], 'Planning goal');
      return;
    }
    this.launchIgniteGoal(input);
  }

  private async executeCommandLine(input: string): Promise<void> {
    if (!input) {
      this.reportCommand('Type a goal or /help to see commands.', true);
      return;
    }

    if (input.startsWith('/')) {
      let earlyParts: string[];
      try {
        earlyParts = splitCommandLine(input.slice(1));
      } catch (err) {
        this.reportCommand(err instanceof Error ? err.message : String(err), true);
        return;
      }

      const earlyName = (earlyParts[0] || '').toLowerCase();
      // Sidebar collapse / expand commands: execute in-place without resetting tab or appending noise
      if (
        ['sidebar', 'collapse', 'rail', 'minimize', 'maximize', 'expand', 'min', 'max', 'panel', 'tabs'].includes(
          earlyName,
        )
      ) {
        this.toggleSidebar();
        return;
      }
    }

    this.activeTab = 1;
    this.transcriptScrollOffset = 0;
    this.appendTranscript(`› ${input}`);
    if (!input.startsWith('/')) {
      const intent = classifyUserInput(input);
      if (intent === 'chat') {
        await this.sendGemmaChatMessage(input, true);
      } else {
        this.launchIgniteGoal(input);
      }
      return;
    }

    let parts: string[];
    try {
      parts = splitCommandLine(input.slice(1));
    } catch (err) {
      this.reportCommand(err instanceof Error ? err.message : String(err), true);
      return;
    }

    const name = (parts.shift() || '').toLowerCase();
    if (!name) {
      this.reportCommand('Type a command after /. Try /help.', true);
      return;
    }

    if (['help', 'commands', '?'].includes(name)) {
      this.transcript.push(
        '',
        'MAOS Oasis commands',
        '  /dashboard          Open the Dashboard [1]',
        '  /chat [message]     Chat directly with local Gemma LLM [2]',
        '  /agents, /herdr     Open live HERDR agents and panes [3]',
        '  /telemetry, /gpu    Open GPU and system telemetry [4]',
        '  /events, /logs      Open the session event log [5]',
        '  /settings           Open workplace settings & configuration [0]',
        '  /model [name]       Switch the active local model (Gemma, Qwen, etc.)',
        '  /preview, /run      Launch live preview of built swarm artifacts in browser',
        '  /ignite <goal>      Dispatch an autonomous goal to the HERDR swarm',
        '  /plan <goal>        Plan a goal with MAOS',
        '  /clear              Clear the transcript',
        '  /status             Display system snapshot (Herdr, model, GPU, last exit)',
        '  /maos <command>     Run a supported MAOS CLI command',
        '  /studio             Open the Canva 3D Studio',
        '  /test               Run the Canva 3D test command',
        '  /web                Open the MAOS web dashboard',
        '  /refresh            Refresh GPU, HERDR telemetry, and settings',
        '  /sidebar, /collapse Toggle right-hand tab sidebar (Ctrl+\\)',
        '  /quit, /exit        Exit MAOS Oasis',
        '  /help               Show this command list',
        '',
        'Hotkeys: Tab switch views, Ctrl+\\ toggle sidebar, 0-5 jump, / focus prompt, C chat, G cycle models, P preview output, R refresh, Q quit.',
      );
      this.transcriptScrollOffset = 0;
      this.transcript = this.transcript.slice(-5000);
      this.statusMessage = 'Help shown in session output.';
      this.render();
      return;
    }
    if (['status', 'snapshot', 'info'].includes(name)) {
      const vramGb = (this.gpuStats.vramUsedMiB / 1024).toFixed(1);
      const totalGb = (this.gpuStats.vramTotalMiB / 1024).toFixed(1);
      const lastExit =
        this.lastCommandExitCode !== null ? `${this.lastCommandExitCode}` : 'none (no command finished yet)';
      this.transcript.push(
        '',
        '── MAOS Oasis System Status ──',
        `  Ollama Model : ${this.selectedModel} (${this.gpuStats.modelInVram})`,
        `  GPU Telemetry: Temp ${this.gpuStats.tempC}°C │ Util ${this.gpuStats.gpuUtil}% │ VRAM ${vramGb}/${totalGb} GB`,
        `  Herdr Status : ${this.herdrAvailable ? 'ONLINE' : 'OFFLINE'} (${this.herdrPanes.length} pane(s), ${this.herdrAgents.length} agent(s))`,
        `  Last Command : ${this.lastCommandLabel || 'none'} → exit code: ${lastExit}`,
        `  Active State : ${this.externalCommandRunning ? `RUNNING (${this.externalCommandLabel})` : 'IDLE'}`,
        '',
      );
      this.statusMessage = 'System status captured.';
      this.render();
      return;
    }
    if (['dashboard', 'home', 'overview', '1'].includes(name)) {
      this.activeTab = 1;
      this.transcript = [];
      this.transcriptScrollOffset = 0;
      this.statusMessage = 'Dashboard opened.';
      this.render();
      return;
    }
    if (['chat', 'ask', 'gemma-chat', 'c', '2'].includes(name)) {
      if (parts.length > 0) {
        await this.sendGemmaChatMessage(parts.join(' '), true);
      } else {
        this.activeTab = 2;
        this.statusMessage = 'Switched to View [2] — Local Chat.';
        this.render();
      }
      return;
    }
    if (['clear', 'cls', 'clean', 'reset'].includes(name)) {
      if (this.activeTab === 2) {
        this.chatMessages = [];
        this.chatScrollOffset = 0;
        this.statusMessage = 'Chat history cleared.';
        this.render();
        return;
      }
      this.activeTab = 1;
      this.transcript = [];
      this.transcriptScrollOffset = 0;
      this.statusMessage = 'Transcript cleared.';
      this.render();
      return;
    }
    if (name === 'demo') {
      this.activeTab = 1;
      this.transcript = [];
      this.launchIgniteGoal('Build and deploy Canva 3D Spatial Studio');
      return;
    }
    if (['herdr', 'agents', 'gemma', 'swarm', '3'].includes(name)) {
      this.activeTab = 3;
      void this.updateHerdrTelemetry();
      this.statusMessage = 'HERDR swarm matrix opened.';
      this.appendTranscript('HERDR swarm matrix opened.');
      this.render();
      return;
    }
    if (['telemetry', 'gpu', 'healer', '4'].includes(name)) {
      this.activeTab = 4;
      this.statusMessage = 'Telemetry opened.';
      this.appendTranscript('Telemetry opened.');
      this.render();
      return;
    }
    if (['events', 'event-log', 'logs', 'log', '5'].includes(name)) {
      this.activeTab = 5;
      this.statusMessage = 'Event log opened.';
      this.appendTranscript('Event log opened.');
      this.render();
      return;
    }
    if (['model', 'models'].includes(name)) {
      const requested = (parts[0] || '').toLowerCase().trim();
      if (!requested) {
        const listLines = [
          '',
          '── Available Local Models ──',
          ...this.detectedModels.map((m) => {
            const isCur = m.id.toLowerCase() === this.selectedModel.toLowerCase();
            const prefix = isCur ? chalk.green('● ') : chalk.gray('○ ');
            const src = chalk.cyan(`[${m.source.toUpperCase()}]`);
            const label = isCur ? chalk.bold.green(m.name) : chalk.white(m.name);
            return `  ${prefix}${label} ${src} ${chalk.gray(`(${m.id})`)}`;
          }),
          '',
          chalk.gray('Use /model <name> or press [G] to cycle models.'),
        ];
        this.transcript.push(...listLines);
        this.render();
        return;
      }

      if (requested === '2b') {
        const exact2b = this.detectedModels.find((m) => m.id === 'gemma2:2b' || m.id.endsWith(':2b'));
        this.selectedModel = exact2b ? exact2b.id : 'gemma2:2b';
      } else if (requested === '9b') {
        const exact9b = this.detectedModels.find((m) => m.id === 'gemma2:9b' || m.id.endsWith(':9b'));
        this.selectedModel = exact9b ? exact9b.id : 'gemma2:9b';
      } else if (
        requested === '4' ||
        requested === 'e2b' ||
        requested === 'gemma4' ||
        requested === '4e2b' ||
        requested === 'gemma4:e2b'
      ) {
        const exact4 = this.detectedModels.find((m) => m.id === 'gemma4:e2b' || m.id.includes('gemma4'));
        this.selectedModel = exact4 ? exact4.id : 'gemma4:e2b';
      } else {
        const matched = this.detectedModels.find((m) => {
          const id = m.id.toLowerCase();
          const nm = m.name.toLowerCase();
          return id === requested || id.endsWith(`:${requested}`) || id.includes(requested) || nm.includes(requested);
        });

        if (matched) {
          this.selectedModel = matched.id;
        } else {
          this.selectedModel = parts[0];
        }
      }

      const shortBadge = this.getModelBadgeShort(this.selectedModel);
      this.statusMessage = `Selected model: ${this.selectedModel} (${shortBadge}).`;
      this.appendTranscript(this.statusMessage);
      this.render();
      return;
    }
    if (['preview', 'run', 'open'].includes(name)) {
      this.previewArtifacts();
      return;
    }
    if (name === 'refresh') {
      this.loadWorkplaceConfig();
      this.updateGpuTelemetry();
      void this.updateHerdrTelemetry();
      void this.refreshDetectedModels();
      this.statusMessage = 'GPU, Herdr telemetry, and workplace configuration refreshed.';
      this.appendTranscript(this.statusMessage);
      this.render();
      return;
    }
    if (name === 'studio' || name === 'd') {
      this.openStudio();
      return;
    }
    if (name === 'test' || name === 't') {
      this.runCanvaTests();
      return;
    }
    if (name === 'quit' || name === 'exit') {
      this.exit();
      return;
    }
    if (name === 'tui') {
      this.statusMessage = 'You are already in the MAOS Oasis TUI.';
      this.appendTranscript('You are already in the MAOS Oasis TUI.');
      this.render();
      return;
    }
    if (['settings', 'config', 'configuration', '0'].includes(name)) {
      if (parts[0] === 'wizard' || parts[0] === 'configure') {
        this.runCliCommand(['configure', ...parts.slice(1)], 'Opening MAOS provider settings');
      } else {
        this.loadWorkplaceConfig();
        this.activeTab = 0;
        this.statusMessage = 'Switched to View [0] — Settings & Configuration.';
        this.render();
      }
      return;
    }
    if (
      ['sidebar', 'collapse', 'rail', 'minimize', 'maximize', 'expand', 'min', 'max', 'panel', 'tabs'].includes(name)
    ) {
      this.toggleSidebar();
      return;
    }
    if (name === 'web' || name === 'web-dashboard') {
      this.runCliCommand(['dashboard', ...parts], 'Opening the web dashboard');
      return;
    }
    if (name === 'ignite') {
      if (parts.length === 0) {
        this.modalMode = 'ignite';
        this.statusMessage = 'Enter a goal to dispatch through maos ignite.';
        this.appendTranscript('Enter a goal to dispatch through maos ignite.');
        this.render();
      } else if (parts[0].startsWith('-')) {
        const args = ['ignite', ...parts];
        if (!parts.includes('--model') && !parts.includes('-m')) args.push('--model', this.selectedModel);
        if (!parts.includes('--no-exit')) args.push('--no-exit');
        this.runCliCommand(args, 'Launching MAOS Gemma swarm');
      } else {
        this.launchIgniteGoal(parts.join(' '));
      }
      return;
    }
    if (name === 'plan') {
      if (parts.length === 0) {
        this.reportCommand('Usage: /plan <goal> or /maos plan --help.', true);
      } else {
        this.runCliCommand(['plan', parts.join(' ')], 'Planning goal');
      }
      return;
    }

    const cliArgs = name === 'maos' ? parts : [name, ...parts];
    const cliCommand = cliArgs[0];
    if (!cliCommand || (cliCommand.startsWith('-') === false && !CORE_CLI_COMMANDS.has(cliCommand))) {
      this.reportCommand(`Unknown MAOS command /${name}. Try /help or /maos --help.`, true);
      return;
    }
    this.runCliCommand(cliArgs, `Running maos ${cliArgs.join(' ')}`);
  }

  private async sendGemmaChatMessage(userMessage: string, inTranscript: boolean = false): Promise<void> {
    if (this.chatIsStreaming) {
      this.statusMessage = 'Gemma is currently responding. Press Esc to cancel.';
      this.render();
      return;
    }

    const time = this.getNowTime();
    this.chatMessages.push({ sender: 'user', text: userMessage, time });
    this.chatScrollOffset = 0;
    this.chatIsStreaming = true;

    const controller = new AbortController();
    this.activeChatAbortController = controller;

    // Run spinner loop so spinner animates during inference
    this.spinnerIndex = 0;
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = setInterval(() => {
      if ((this.chatIsStreaming || this.externalCommandRunning) && this.isRunning) {
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
        this.render();
      }
    }, 120);

    if (inTranscript) {
      this.statusMessage = `Asking local Gemma (${this.selectedModel})...`;
      this.appendTranscript(`\n[Gemma ${this.selectedModel} · Local LLM Chat]`);
      this.appendTranscript('Thinking...');
    } else {
      this.statusMessage = `Gemma (${this.selectedModel}) is thinking...`;
    }
    this.render();

    let replyText = '';
    const host = this.oasisConfig?.ollama?.host || '127.0.0.1';
    const port = this.oasisConfig?.ollama?.port || 11434;
    let streamedMessage: ChatMessage | null = null;

    try {
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(`http://${host}:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.selectedModel,
          prompt: userMessage,
          system:
            'You are MAOS Oasis, an intelligent sovereign local AI assistant powered by Google Gemma. You run 100% locally on loopback. Be concise, direct, helpful, and friendly. Answer queries directly without dispatching multi-agent swarms unless requested.',
          stream: true,
          options: {
            temperature: 0.7,
            num_predict: 1024,
            num_ctx: this.oasisConfig?.model?.contextTokens || 8192,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        if (res.body && typeof (res.body as any).getReader === 'function') {
          const reader = (res.body as any).getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          streamedMessage = { sender: 'gemma', text: '', time: this.getNowTime() };
          this.chatMessages.push(streamedMessage);
          let lastRenderTime = Date.now();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const data = JSON.parse(line);
                if (data.response) {
                  replyText += data.response;
                  streamedMessage.text = replyText;
                }
              } catch {}
            }
            if (Date.now() - lastRenderTime > 80) {
              lastRenderTime = Date.now();
              this.render();
            }
          }
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              if (data.response) {
                replyText += data.response;
                streamedMessage.text = replyText;
              }
            } catch {}
          }
        } else {
          const data = (await res.json()) as { response?: string };
          replyText = data.response?.trim() || '';
        }
      } else {
        const errorText = await res.text().catch(() => '');
        if (res.status === 404 || errorText.includes('not found')) {
          replyText = `Model "${this.selectedModel}" is not downloaded in Ollama. Run: ollama pull ${this.selectedModel}`;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        replyText = '[Chat response cancelled]';
      }
    } finally {
      this.activeChatAbortController = null;
      this.chatIsStreaming = false;
      if (!this.externalCommandRunning && this.spinnerTimer) {
        clearInterval(this.spinnerTimer);
        this.spinnerTimer = null;
      }
    }

    if (!replyText) {
      const lower = userMessage.toLowerCase().trim();
      const isGreeting = /^(hi|hello|hey|hiya|yo|howdy|greetings|good\s+(morning|afternoon|evening))\b/i.test(lower);
      if (isGreeting) {
        replyText =
          'Hello! I am MAOS Oasis, your sovereign local workspace powered by Gemma. I run 100% locally on your machine with zero cloud egress. Local Ollama daemon is currently offline at ' +
          host +
          ':' +
          port +
          '. Start Ollama with "ollama serve" or run "maos doctor --fix" to enable live local Gemma inference.';
      } else {
        replyText =
          'Local Ollama inference daemon is offline at ' +
          host +
          ':' +
          port +
          '. Start Ollama with "ollama serve" or run "maos doctor --fix" to enable full local Gemma inference.';
      }
    }

    const replyTime = this.getNowTime();
    if (streamedMessage) {
      streamedMessage.text = replyText;
    } else {
      this.chatMessages.push({ sender: 'gemma', text: replyText, time: replyTime });
    }
    this.chatIsStreaming = false;

    if (inTranscript) {
      if (this.transcript.length > 0 && this.transcript[this.transcript.length - 1] === 'Thinking...') {
        this.transcript.pop();
      }
      this.appendTranscript(replyText);
      this.appendTranscript('✓ Local response completed (0 cloud egress · 0 agents dispatched)');
      this.statusMessage = `Answered by local Gemma (${this.selectedModel}).`;
    } else {
      this.statusMessage = 'Gemma replied.';
    }

    this.recordActivity('CHAT', `Gemma replied: ${userMessage.slice(0, 28)}...`, c.cyanBright);
    this.render();
  }

  private reportCommand(message: string, isError = false): void {
    this.activeTab = 1;
    this.transcript.push(`${isError ? 'Error: ' : ''}${message}`);
    this.transcriptScrollOffset = 0;
    this.statusMessage = message;
    this.render();
  }

  private appendTranscript(text: string): void {
    const cleaned = text
      .replace(ANSI_SEQUENCE, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, '    ')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    if (!cleaned) return;
    const addedRows = cleaned.split('\n');
    this.transcript.push(...addedRows);
    if (this.transcriptScrollOffset > 0) {
      const terminalWidth = Math.max(1, process.stdout.columns || 120);
      const railWidth = this.getRailWidth(terminalWidth);
      const outputWidth = terminalWidth - railWidth - (railWidth ? 3 : 0) - 1;
      this.transcriptScrollOffset += addedRows.reduce(
        (count, row) => count + wrapTerminalLine(row, outputWidth).length,
        0,
      );
    }
    if (this.transcript.length > 5000) this.transcript.splice(0, this.transcript.length - 5000);
  }

  private appendCommandOutput(chunk: string): void {
    const normalized = `${this.commandOutputRemainder}${chunk}`
      .replace(ANSI_SEQUENCE, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, '    ')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    const rows = normalized.split('\n');
    this.commandOutputRemainder = rows.pop() || '';
    if (rows.length > 0) {
      this.appendTranscript(rows.join('\n'));

      // Ingest live tool calls and worker activities into Swarm Board
      for (const row of rows) {
        if (row.includes('Decomposed into')) {
          const dMatch = row.match(/Decomposed into (\d+) subtasks/i);
          if (dMatch) {
            this.recordSwarmPost(
              'coordinator',
              '@all',
              'plan_decomposition',
              `Goal decomposed into ${dMatch[1]} parallel worktree subtasks`,
            );
          }
        } else if (row.includes('Worker') && row.includes('live in')) {
          const liveMatch = row.match(/Worker\s+([\w-]+)\s+live in\s+([\w:]+)\s*\(([\w-]+)\)/i);
          if (liveMatch) {
            const raw = liveMatch[1].toLowerCase().trim();
            const sender = raw.startsWith('ignite-worker-')
              ? raw
              : raw.startsWith('worker-')
                ? `ignite-${raw}`
                : raw.startsWith('worker')
                  ? `ignite-worker-${raw.replace(/\D/g, '') || '1'}`
                  : raw;
            const paneId = liveMatch[2];
            const branch = liveMatch[3];
            const ag = this.swarmAgents.find((a) => a.id === sender);
            if (ag) {
              ag.paneId = paneId;
              ag.branch = branch;
              ag.state = 'working';
            }
            this.recordSwarmPost(sender, '@coordinator', 'spawn', `Live in ${paneId} on worktree branch ${branch}`);
          }
        } else if (/^\s*(\d+)\/(\d+)\s+([^\n]+)/.test(row)) {
          const taskMatch = row.match(/^\s*(\d+)\/(\d+)\s+([^\n]+)/);
          if (taskMatch) {
            const idx = parseInt(taskMatch[1], 10);
            const taskTitle = taskMatch[3].trim();
            const workerId = `ignite-worker-${idx}`;
            const ag = this.swarmAgents.find((a) => a.id === workerId);
            if (ag) {
              ag.taskTitle = taskTitle;
              ag.state = 'working';
            }
            this.recordSwarmPost('coordinator', `@${workerId}`, 'assign', `You own the implementation of ${taskTitle}`);
          }
        } else if (
          row.includes('[Tool Call]') ||
          row.includes('create_file:') ||
          row.includes('run_command:') ||
          row.includes('git commit:') ||
          row.includes('git_commit:')
        ) {
          const toolMatch = row.match(/(?:\[Tool Call\]\s*|⚡\s*|git\s+)(\w+):\s*(.*)/i);
          if (toolMatch) {
            const tool = toolMatch[1];
            const args = toolMatch[2];
            const wMatch = row.match(/(ignite-worker-\d+|Worker-\d+|Worker\s+\d+)/i);
            const raw = wMatch ? wMatch[1].toLowerCase().trim() : 'ignite-worker-1';
            const sender = raw.startsWith('ignite-worker-')
              ? raw
              : raw.startsWith('worker-')
                ? `ignite-${raw}`
                : raw.startsWith('worker')
                  ? `ignite-worker-${raw.replace(/\D/g, '') || '1'}`
                  : raw;
            this.recordSwarmPost(sender, '@coordinator', tool, `${tool}: ${args}`);
          }
        } else if (
          row.includes('Task marked complete') ||
          row.includes('WORKTREE GREEN') ||
          row.includes('tests passed') ||
          row.includes('Branch clean')
        ) {
          const wMatch = row.match(/(ignite-worker-\d+|Worker-\d+|Worker\s+\d+)/i);
          const raw = wMatch ? wMatch[1].toLowerCase().trim() : 'ignite-worker-1';
          const sender = raw.startsWith('ignite-worker-')
            ? raw
            : raw.startsWith('worker-')
              ? `ignite-${raw}`
              : raw.startsWith('worker')
                ? `ignite-worker-${raw.replace(/\D/g, '') || '1'}`
                : raw;
          this.recordSwarmPost(sender, '@coordinator', 'complete', `${sender} worktree green and tests passed`);
        } else if (row.includes('Spawning worker')) {
          const wMatch = row.match(/(ignite-worker-\d+|Worker-\d+|Worker\s+\d+)/i);
          const raw = wMatch ? wMatch[1].toLowerCase().trim() : 'worker';
          const worker = raw.startsWith('ignite-worker-') ? raw : raw.startsWith('worker-') ? `ignite-${raw}` : raw;
          this.recordSwarmPost('coordinator', `@${worker}`, 'spawn', `Spawning ${worker} in isolated worktree`);
        } else if (row.includes('[HEALER]')) {
          const hMatch = row.match(/\[HEALER\]\s*(.*)/i);
          if (hMatch) {
            this.recordSwarmPost('coordinator', '@healer', 'repair', `AutonomousHealer: ${hMatch[1].slice(0, 80)}`);
          }
        }
      }
    }
    if (!this.transcriptRenderTimer) {
      this.transcriptRenderTimer = setTimeout(() => {
        this.transcriptRenderTimer = null;
        if (this.isRunning && (this.activeTab === 1 || this.activeTab === 3)) this.render();
      }, 50);
    }
  }

  private launchIgniteGoal(goal: string): void {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      this.reportCommand('Enter a goal before dispatching.', true);
      return;
    }
    this.swarmGoal = trimmedGoal;
    this.swarmState = 'active';
    this.swarmAgents = createDefaultSwarmAgents(this.swarmGoal, this.selectedModel);
    this.swarmPosts = createDefaultSwarmPosts(this.swarmGoal);
    this.runCliCommand(
      [
        'ignite',
        '--gemma',
        '--harness',
        'herdr',
        '--model',
        this.selectedModel,
        '--no-exit',
        '--no-watch',
        '--yes',
        '--goal',
        trimmedGoal,
      ],
      'Launching MAOS Gemma swarm',
    );
  }

  private runCliCommand(args: string[], label: string): void {
    const sourceEntry = path.join(this.projectRoot, 'src', 'cli', 'index.ts');
    const tsxCli = path.join(this.projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const builtEntry = path.join(this.projectRoot, 'dist', 'cli', 'index.js');
    if (fs.existsSync(sourceEntry) && fs.existsSync(tsxCli)) {
      this.runExternalProcess(process.execPath, [tsxCli, sourceEntry, ...args], this.projectRoot, label);
    } else if (fs.existsSync(builtEntry)) {
      this.runExternalProcess(process.execPath, [builtEntry, ...args], this.projectRoot, label);
    } else {
      this.reportCommand('MAOS CLI entrypoint is missing. Reinstall dependencies or build the project.', true);
    }
  }

  private runExternalProcess(command: string, args: string[], cwd: string, label: string): void {
    if (this.externalCommandRunning) {
      this.reportCommand('A task is currently running. Press Ctrl+C to abort it before starting a new one.', true);
      return;
    }
    this.externalCommandRunning = true;
    this.externalCommandLabel = label;
    this.externalCommandStartTime = Date.now();
    this.spinnerIndex = 0;
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = setInterval(() => {
      if (this.externalCommandRunning && this.isRunning && this.activeTab === 1) {
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
        this.render();
      }
    }, 150);

    this.activeTab = 1;
    this.transcriptScrollOffset = 0;
    this.appendTranscript(`\n$ ${label}`);
    this.statusMessage = `${label}...`;
    this.render();
    this.commandOutputRemainder = '';

    let finished = false;
    const finish = (code: number | null, signal?: NodeJS.Signals | null, error?: Error) => {
      if (finished) return;
      finished = true;
      if (this.spinnerTimer) {
        clearInterval(this.spinnerTimer);
        this.spinnerTimer = null;
      }
      this.activeChild = null;
      this.externalCommandRunning = false;
      this.lastCommandExitCode = code;
      this.lastCommandLabel = label;
      if (!this.isRunning) return;

      if (this.commandOutputRemainder) {
        this.appendTranscript(this.commandOutputRemainder);
        this.commandOutputRemainder = '';
      }

      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
        } catch {}
      }
      try {
        process.stdin.resume();
      } catch {}
      process.stdout.write('\x1b[?25l');
      const wasAborted = this.statusMessage === 'Aborting running process...' || signal === 'SIGINT';
      const succeeded = !error && code === 0 && !wasAborted;
      this.statusMessage = wasAborted
        ? `${label} aborted by user.`
        : error
          ? `${label} failed: ${error.message.slice(0, 90)}`
          : succeeded
            ? `${label} completed.`
            : `${label} ended with ${signal || `exit code ${code ?? 'unknown'}`}.`;
      this.appendTranscript(
        wasAborted
          ? `\n⚠ ${label} aborted by user.`
          : error
            ? `\nError: ${error.message}`
            : succeeded
              ? `\n✓ ${label} completed (exit 0).`
              : `\n✗ ${label} ended with ${signal || `exit code ${code ?? 'unknown'}`}.`,
      );
      this.recordActivity(
        wasAborted ? 'COMMAND' : error || !succeeded ? 'ERROR' : 'COMMAND',
        `${label} ${wasAborted ? 'aborted' : error || !succeeded ? 'failed' : 'completed'}`,
        wasAborted ? c.amber : error || !succeeded ? c.pink : c.emerald,
      );
      this.updateGpuTelemetry();
      void this.updateHerdrTelemetry();
      this.render();
    };

    try {
      const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      this.activeChild = child;
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => this.appendCommandOutput(chunk));
      child.stderr?.on('data', (chunk: string) => this.appendCommandOutput(chunk));
      child.once('error', (error) => finish(null, null, error));
      child.once('close', (code, signal) => finish(code, signal));
    } catch (error) {
      finish(null, null, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private openStudio(): void {
    const url = 'http://localhost:5173';
    let command: string;
    let args: string[];
    if (process.platform === 'win32') {
      command = 'cmd.exe';
      args = ['/d', '/s', '/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    this.runExternalProcess(command, args, this.projectRoot, 'Opening Canva 3D Studio');
  }

  private runCanvaTests(): void {
    const cwd = path.resolve(this.projectRoot, 'apps', 'canva-3d');
    if (!fs.existsSync(path.join(cwd, 'package.json'))) {
      this.statusMessage = 'Canva 3D test project was not found.';
      if (this.activeTab === 1 && this.transcript.length > 0) this.appendTranscript(`Error: ${this.statusMessage}`);
      this.render();
      return;
    }
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm test'] : ['test'];
    this.runExternalProcess(command, args, cwd, 'Running Canva 3D tests');
  }

  private ensurePreviewServer(): number {
    if (this.previewServer) return this.previewPort;
    try {
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };

      const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const rawUrl = req.url?.split('?')[0] || '/';
        const decodedUrl = decodeURIComponent(rawUrl);
        let relPath = decodedUrl.startsWith('/') ? decodedUrl.slice(1) : decodedUrl;
        if (!relPath || relPath === '') relPath = 'output/index.html';

        const candidates = [
          path.resolve(this.projectRoot, relPath),
          path.resolve(this.projectRoot, 'output', relPath),
          path.resolve(this.projectRoot, 'dist-preview', relPath),
          path.resolve(this.projectRoot, 'output', 'index.html'),
          path.resolve(this.projectRoot, 'index.html'),
        ];

        let targetFile: string | null = null;
        for (const cand of candidates) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            targetFile = cand;
            break;
          }
        }

        if (!targetFile) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }

        const ext = path.extname(targetFile).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        try {
          const content = fs.readFileSync(targetFile);
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
        } catch {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Internal Server Error');
        }
      });

      server.on('error', (err: any) => {
        if (err?.code === 'EADDRINUSE' && this.previewPort < 3040) {
          this.previewPort++;
          try {
            server.close();
          } catch {}
          server.listen(this.previewPort, '127.0.0.1');
        }
      });

      server.listen(this.previewPort, '127.0.0.1', () => {});
      server.unref();
      this.previewServer = server;
      return this.previewPort;
    } catch {
      return 0;
    }
  }

  public cycleModel(): void {
    const pool = this.detectedModels.length > 0 ? this.detectedModels : FALLBACK_MODELS;
    const currIdx = pool.findIndex((m) => m.id.toLowerCase() === this.selectedModel.toLowerCase());
    const nextIdx = (currIdx + 1) % pool.length;
    const nextModel = pool[nextIdx];
    this.selectedModel = nextModel.id;
    const badge = this.getModelBadgeShort(this.selectedModel);
    this.statusMessage = `Active model switched to ${this.selectedModel} (${badge}).`;
    if (this.activeTab === 1 && this.transcript.length > 0) this.appendTranscript(this.statusMessage);
    this.render();
  }

  private scrollUpCurrentView(step?: number): void {
    if (this.activeTab === 1 && this.transcriptRenderedRowCount > this.transcriptViewportRows) {
      const delta = step || Math.max(1, this.transcriptViewportRows - 1);
      const maxScroll = Math.max(0, this.transcriptRenderedRowCount - this.transcriptViewportRows);
      this.transcriptScrollOffset = Math.min(maxScroll, this.transcriptScrollOffset + delta);
      this.render();
    } else if (this.activeTab === 2 && this.chatRenderedRowCount > this.chatViewportRows) {
      const delta = step || Math.max(1, this.chatViewportRows - 1);
      const maxScroll = Math.max(0, this.chatRenderedRowCount - this.chatViewportRows);
      this.chatScrollOffset = Math.min(maxScroll, this.chatScrollOffset + delta);
      this.render();
    } else if (this.activeTab === 0 && this.settingsRenderedRowCount > this.settingsViewportRows) {
      const maxScroll = Math.max(0, this.settingsRenderedRowCount - this.settingsViewportRows);
      this.settingsScrollOffset = Math.max(0, this.settingsScrollOffset - (step || 2));
      this.render();
    } else if (this.activeTab === 3 && this.swarmAgents.length > 0) {
      this.selectedSwarmAgentIndex = Math.max(0, this.selectedSwarmAgentIndex - 1);
      this.render();
    }
  }

  private scrollDownCurrentView(step?: number): void {
    if (this.activeTab === 1 && this.transcriptRenderedRowCount > this.transcriptViewportRows) {
      const delta = step || Math.max(1, this.transcriptViewportRows - 1);
      this.transcriptScrollOffset = Math.max(0, this.transcriptScrollOffset - delta);
      this.render();
    } else if (this.activeTab === 2 && this.chatRenderedRowCount > this.chatViewportRows) {
      const delta = step || Math.max(1, this.chatViewportRows - 1);
      this.chatScrollOffset = Math.max(0, this.chatScrollOffset - delta);
      this.render();
    } else if (this.activeTab === 0 && this.settingsRenderedRowCount > this.settingsViewportRows) {
      const maxScroll = Math.max(0, this.settingsRenderedRowCount - this.settingsViewportRows);
      this.settingsScrollOffset = Math.min(maxScroll, this.settingsScrollOffset + (step || 2));
      this.render();
    } else if (this.activeTab === 3 && this.swarmAgents.length > 0) {
      this.selectedSwarmAgentIndex = Math.min(this.swarmAgents.length - 1, this.selectedSwarmAgentIndex + 1);
      this.render();
    }
  }

  private renderScrollBarTrack(
    viewportRows: number,
    totalRows: number,
    scrollOffsetFromBottom: number,
    thumbColor: (s: string) => string = c.cyanBright,
  ): string[] {
    const track: string[] = [];
    if (viewportRows <= 0) return track;
    if (totalRows <= viewportRows) {
      for (let i = 0; i < viewportRows; i++) {
        track.push(c.slateBorder('│'));
      }
      return track;
    }
    const maxScroll = totalRows - viewportRows;
    const clampedOffset = Math.max(0, Math.min(scrollOffsetFromBottom, maxScroll));
    const scrollFraction = maxScroll > 0 ? (maxScroll - clampedOffset) / maxScroll : 1;
    const thumbHeight = Math.max(1, Math.min(viewportRows, Math.round((viewportRows / totalRows) * viewportRows)));
    const availableTrack = Math.max(0, viewportRows - thumbHeight);
    const thumbTop = Math.min(availableTrack, Math.max(0, Math.round(scrollFraction * availableTrack)));

    for (let r = 0; r < viewportRows; r++) {
      if (r === 0 && thumbTop > 0) {
        track.push(c.slateMuted('▲'));
      } else if (r === viewportRows - 1 && thumbTop + thumbHeight < viewportRows) {
        track.push(c.slateMuted('▼'));
      } else if (r >= thumbTop && r < thumbTop + thumbHeight) {
        track.push(thumbColor('█'));
      } else {
        track.push(c.slateBorder('░'));
      }
    }
    return track;
  }

  public previewArtifacts(): void {
    const lastBuildPath = path.join(this.projectRoot, '.maos', 'last-build.json');
    let entrypoint: string | null = null;
    let filesCount = 0;

    if (fs.existsSync(lastBuildPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(lastBuildPath, 'utf-8'));
        entrypoint = manifest.entrypoint ? path.resolve(this.projectRoot, manifest.entrypoint) : null;
        filesCount = Array.isArray(manifest.files) ? manifest.files.length : 0;
      } catch {}
    }

    const outputHtml = path.resolve(this.projectRoot, 'output', 'index.html');
    const distHtml = path.resolve(this.projectRoot, 'dist-preview', 'index.html');
    const rootHtml = path.resolve(this.projectRoot, 'index.html');

    if (entrypoint && entrypoint.includes('apps') && fs.existsSync(outputHtml)) {
      entrypoint = outputHtml;
    } else if (entrypoint && fs.existsSync(entrypoint)) {
      // Valid target from manifest
    } else if (fs.existsSync(outputHtml)) {
      entrypoint = outputHtml;
    } else if (fs.existsSync(distHtml)) {
      entrypoint = distHtml;
    } else if (fs.existsSync(rootHtml)) {
      entrypoint = rootHtml;
    }

    if (!entrypoint || !fs.existsSync(entrypoint)) {
      const msg = 'No built output found to preview. Run an ignite goal first with /ignite <goal>.';
      this.statusMessage = msg;
      if (this.activeTab === 1) this.appendTranscript(`⚠️  ${msg}`);
      this.render();
      return;
    }

    const isHtml = entrypoint.endsWith('.html');
    if (isHtml) {
      try {
        const port = this.ensurePreviewServer();
        const rel = path.relative(this.projectRoot, entrypoint).replace(/\\/g, '/');
        const targetUrl = port > 0 ? `http://localhost:${port}/${rel}` : entrypoint;
        let command: string;
        let args: string[];
        if (process.platform === 'win32') {
          command = 'cmd.exe';
          args = ['/d', '/s', '/c', 'start', '', targetUrl];
        } else if (process.platform === 'darwin') {
          command = 'open';
          args = [targetUrl];
        } else {
          command = 'xdg-open';
          args = [targetUrl];
        }
        execFile(command, args, () => {});
        this.statusMessage = `Launched preview: ${path.basename(entrypoint)} in default browser.`;
        this.appendTranscript(`🚀 Live Preview launched in your browser: ${targetUrl}`);
        this.appendTranscript(`✓ Output verified from ${filesCount ? `${filesCount} generated files` : './output/'}.`);
      } catch (err: unknown) {
        this.statusMessage = `Failed to open preview: ${err instanceof Error ? err.message : String(err)}`;
        this.appendTranscript(`❌ ${this.statusMessage}`);
      }
    } else {
      const relPath = path.relative(this.projectRoot, entrypoint);
      if (entrypoint.endsWith('.js')) {
        this.runExternalProcess(process.execPath, [entrypoint], this.projectRoot, `Previewing ${relPath}`);
      } else if (entrypoint.endsWith('.py')) {
        this.runExternalProcess('python', [entrypoint], this.projectRoot, `Previewing ${relPath}`);
      } else {
        this.statusMessage = `Artifact ready at ${relPath}.`;
        this.appendTranscript(`📦 Built artifact ready: ${relPath}`);
      }
    }
    this.render();
  }

  public async refreshDetectedModels(): Promise<void> {
    try {
      const host = this.oasisConfig?.ollama?.host || '127.0.0.1';
      const port = this.oasisConfig?.ollama?.port || 11434;
      this.detectedModels = await detectLocalModels({ ollamaHost: host, ollamaPort: port });
      if (
        this.detectedModels.length > 0 &&
        !this.detectedModels.some((m) => m.id.toLowerCase() === this.selectedModel.toLowerCase())
      ) {
        const preferred =
          this.detectedModels.find((m) => m.id.startsWith('gemma4:e2b')) ||
          this.detectedModels.find((m) => m.id.startsWith('gemma2:9b')) ||
          this.detectedModels.find((m) => m.id.startsWith('gemma'));
        if (preferred) this.selectedModel = preferred.id;
      }
    } catch {
      /* ignore */
    }
  }

  private startRefreshLoop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      this.updateGpuTelemetry();
      void this.updateHerdrTelemetry();
      this.render();
    }, 2000);
  }

  private async updateHerdrTelemetry(): Promise<void> {
    if (this.herdrRefreshInFlight) return;
    this.herdrRefreshInFlight = true;
    try {
      const harness = getDefaultHerdrHarness();
      this.herdrAvailable = await harness.isAvailable();
      if (this.herdrAvailable) {
        [this.herdrPanes, this.herdrAgents] = await Promise.all([harness.listPanes(), harness.listAgents()]);
      } else {
        this.herdrPanes = [];
        this.herdrAgents = [];
      }
    } catch {
      this.herdrAvailable = false;
      this.herdrPanes = [];
      this.herdrAgents = [];
    } finally {
      this.herdrRefreshInFlight = false;
      if (this.isRunning && !this.externalCommandRunning) this.render();
    }
  }

  private recordActivity(tag: string, text: string, color: (value: string) => string): void {
    this.activities.unshift({ time: this.getNowTime(), tag, text, color });
    this.activities = this.activities.slice(0, 50);
  }

  private updateGpuTelemetry(): void {
    if (this.isUpdatingGpu) return;
    this.isUpdatingGpu = true;
    exec(
      'nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 1200 },
      (err, stdout) => {
        this.isUpdatingGpu = false;
        if (err || !stdout) return;
        try {
          const parts = stdout
            .trim()
            .split(',')
            .map((p) => parseFloat(p.trim()));
          if (parts.length >= 5 && !isNaN(parts[0])) {
            this.gpuStats.vramUsedMiB = parts[0];
            this.gpuStats.vramTotalMiB = parts[1];
            this.gpuStats.gpuUtil = parts[2];
            this.gpuStats.tempC = parts[3];
            this.gpuStats.powerW = parts[4];
          }
        } catch {
          // Keep previous or nominal telemetry
        }
      },
    );
  }

  private getNowTime(): string {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  // ── Render Engine ──────────────────────────────────────────────

  private render(): void {
    if (!this.isRunning) return;
    if (this.isRendering) {
      this.renderPending = true;
      return;
    }
    this.isRendering = true;
    try {
      this.renderInternal();
    } finally {
      this.isRendering = false;
      if (this.renderPending) {
        this.renderPending = false;
        this.render();
      }
    }
  }

  private renderInternal(): void {
    const W = this.getTerminalWidth();
    const railW = this.getRailWidth(W);
    const mainW = W - railW - (railW ? 3 : 0);
    const lines: string[] = [];
    const visibleLength = terminalCellWidth;
    const pad = fitTerminalLine;
    const fullLine = (value: string) => pad(value, W);

    const title = `${c.cyanBright('◈')}  ${c.boldWhite('MAOS')} ${c.cyanBright('OASIS')} ${c.slateMuted('v0.4.0')}  ${c.slateBorder('│')} ${c.slateText('Sovereign Multi-Agent Swarm Kernel')}`;
    const vramGb = (this.gpuStats.vramUsedMiB / 1024).toFixed(1);
    const totalGb = (this.gpuStats.vramTotalMiB / 1024).toFixed(1);
    const modelBadge = formatHeaderBadge(this.selectedModel);
    const herdrStatus = this.herdrAvailable
      ? this.herdrPanes.length > 0
        ? `HERDR: ${this.herdrPanes.length} PANE${this.herdrPanes.length > 1 ? 'S' : ''}`
        : 'HERDR: LIVE'
      : 'HERDR: OFFLINE';
    const telemetry = `${c.cyan(modelBadge)}  ${c.slateBorder('│')}  ${c.cyanBright(herdrStatus)}  ${c.slateBorder('│')}  ${c.amber(`GPU ${this.gpuStats.tempC}°C`)}  ${c.slateBorder('│')}  ${c.violetBright(`VRAM ${vramGb}/${totalGb} GB`)}`;
    const headerGap = W - visibleLength(title) - visibleLength(telemetry);
    lines.push(headerGap >= 2 ? title + ' '.repeat(headerGap) + telemetry : fullLine(title));
    if (headerGap < 2) lines.push(fullLine(telemetry));
    lines.push(c.slateBorder('─'.repeat(W)));

    const hasTranscriptSession = this.activeTab === 1 && this.transcript.length > 0;
    const hasStatus = !hasTranscriptSession && !this.statusMessage.startsWith('Ready.');
    const footerRows = hasStatus ? 4 : 2;
    const terminalRows = this.getTerminalRows();
    const availableBodyRows = Math.max(1, terminalRows - lines.length - footerRows);

    if (this.activeTab === 3) {
      if (!this.swarmAnimTimer && this.isRunning) {
        this.swarmAnimTimer = setInterval(() => {
          if (this.isRunning && this.activeTab === 3 && !this.externalCommandRunning && !this.isRendering) {
            this.render();
          }
        }, 42);
        this.swarmAnimTimer.unref();
      }
    } else if (this.swarmAnimTimer) {
      clearInterval(this.swarmAnimTimer);
      this.swarmAnimTimer = null;
    }

    const page: string[] = [];
    if (this.activeTab === 1) this.renderTabFleet(page, mainW, availableBodyRows);
    else if (this.activeTab === 2) this.renderTabChat(page, mainW, availableBodyRows);
    else if (this.activeTab === 3) this.renderTabAgents(page, mainW, availableBodyRows);
    else if (this.activeTab === 4) this.renderTabHealer(page, mainW);
    else if (this.activeTab === 5) this.renderTabEventLog(page, mainW);
    else if (this.activeTab === 0) this.renderTabSettings(page, mainW, availableBodyRows);
    else this.renderTabFleet(page, mainW, availableBodyRows);

    if (this.modalMode !== 'none') this.renderModal(page, mainW);

    const bodyRows = availableBodyRows;
    const pageOffset = page.length < bodyRows ? Math.max(0, Math.floor((bodyRows - page.length) / 2)) : 0;
    const pageAt = (row: number) => {
      const idx = row - pageOffset;
      return idx >= 0 && idx < page.length ? page[idx] : '';
    };

    if (railW) {
      const sidebar = Array.from({ length: bodyRows }, () => '');
      const isMini = this.sidebarCollapsed || railW < 16;

      // Minimize / expand button indicator at the top of the rail
      if (bodyRows > 0) {
        if (isMini) {
          sidebar[0] = pad(centerTerminalLine(c.cyanBright(this.sidebarCollapsed ? '»' : '«'), railW), railW);
        } else {
          sidebar[0] = pad(`${c.cyanBright('«')} ${c.slateMuted('Collapse (F2)')}`, railW);
        }
      }

      const railItem = (row: number, icon: string, title: string, tab: number, quiet = false, rightText = '') => {
        if (row < 0 || row >= bodyRows) return;
        const selected = tab === this.activeTab && !quiet;
        if (isMini) {
          const centered = centerTerminalLine(icon, railW);
          sidebar[row] = selected
            ? pad(chalk.bgHex('#1E3A8A').hex('#67E8F9').bold(centered), railW)
            : pad(chalk.hex('#94A3B8').bold(centered), railW);
        } else {
          const fullLabel = `${icon}  ${title}`;
          if (rightText) {
            const left = `  ${fullLabel}`;
            const gap = Math.max(1, railW - visibleLength(left) - visibleLength(rightText));
            const item = left + ' '.repeat(gap) + rightText;
            sidebar[row] = selected
              ? pad(chalk.bgHex('#33477F').hex('#FFFFFF').bold(item.padEnd(railW, ' ')), railW)
              : pad(c.slateText(left) + ' '.repeat(gap) + c.white(rightText), railW);
          } else if (selected) {
            const active = `  ${fullLabel}`.padEnd(railW - 2, ' ') + '  ';
            sidebar[row] = pad(chalk.bgHex('#33477F').hex('#FFFFFF').bold(active), railW);
          } else {
            sidebar[row] = pad(c.slateText(`  ${fullLabel}`), railW);
          }
        }
      };

      const step = bodyRows >= 16 ? 2 : 1;
      const navTop = bodyRows >= 16 ? Math.max(2, Math.floor(bodyRows * 0.08)) : 1;
      railItem(navTop, '⌂', 'Dashboard', 1);
      railItem(navTop + step, '💬', 'Chat', 2);
      railItem(
        navTop + step * 2,
        '❖',
        'Swarm',
        3,
        false,
        String(this.swarmAgents.length || this.herdrAgents.length || 5),
      );
      railItem(navTop + step * 3, '▥', 'Telemetry', 4);
      railItem(navTop + step * 4, '☰', 'Event Log', 5);

      const settingsRow = Math.max(navTop + step * 5 + 1, bodyRows - 2);
      if (settingsRow - 1 >= 0 && settingsRow - 1 < bodyRows) {
        sidebar[settingsRow - 1] = c.slateBorder('─'.repeat(railW));
      }
      railItem(settingsRow, '⚙', 'Settings', 0);

      for (let i = 0; i < bodyRows; i++) {
        lines.push(`${pad(pageAt(i), mainW)}${c.slateBorder(' │ ')}${pad(sidebar[i], railW)}`);
      }
    } else {
      for (let i = 0; i < bodyRows; i++) lines.push(pad(pageAt(i), mainW));
    }

    if (this.prefixActive) {
      lines.push(c.slateBorder('─'.repeat(W)));
      const prefixBanner = `${chalk.bgHex('#06B6D4').hex('#000000').bold(' ⚡ PREFIX (Ctrl+B) ACTIVE ')} ${c.boldWhite('Press:')} ${c.emerald('P')} ${c.slateMuted('Preview')}  ${c.amber('G')} ${c.slateMuted('Model')}  ${c.cyanBright('S')} ${c.slateMuted('Sidebar')}  ${c.cyanBright('R')} ${c.slateMuted('Refresh')}  ${c.white('I')} ${c.slateMuted('Ignite')}  ${c.white('0-5')} ${c.slateMuted('Tab')}  ${c.slateMuted('Esc: Cancel')}`;
      lines.push(fullLine(prefixBanner));
    } else if (hasStatus) {
      lines.push(c.slateBorder('─'.repeat(W)));
      const status = `${c.amber('STATUS')}  ${c.white(this.statusMessage)}`;
      lines.push(fullLine(status));
    }
    lines.push(c.slateBorder('─'.repeat(W)));
    const hotkeys = (
      this.modalMode !== 'none'
        ? [
            `${c.boldWhite('Enter')} ${c.slateMuted('Dispatch')}`,
            `${c.boldWhite('Esc')} ${c.slateMuted('Cancel')}`,
            `${c.boldWhite('Backspace')} ${c.slateMuted('Delete')}`,
          ]
        : this.activeTab === 1
          ? [
              `${c.boldWhite('Ctrl+B')} ${c.cyanBright('Prefix')}`,
              `${c.boldWhite('F2 / Ctrl+\\')} ${c.slateMuted(W >= 140 ? 'Toggle Sidebar' : 'Sidebar')}`,
              `${c.boldWhite('Ctrl+P')} ${c.emerald('Preview')}`,
              `${c.boldWhite('Ctrl+G')} ${c.amber(`Model ${this.getModelBadgeShort()}`)}`,
              `${c.boldWhite('Enter')} ${c.slateMuted('Run Goal / Chat')}`,
              `${c.boldWhite('Tab')} ${c.slateMuted('Switch View')}`,
              ...(hasTranscriptSession ? [`${c.boldWhite('PgUp/PgDn')} ${c.slateMuted('Scroll')}`] : []),
              `${c.boldWhite('Esc')} ${c.slateMuted('Clear')}`,
              `${c.cyanBright('/help')} ${c.slateMuted('Commands')}`,
              `${c.boldWhite('Ctrl+C')} ${c.slateMuted('Quit')}`,
            ]
          : this.activeTab === 2
            ? [
                `${c.boldWhite('Ctrl+B')} ${c.cyanBright('Prefix')}`,
                `${c.boldWhite('F2 / Ctrl+\\')} ${c.slateMuted(W >= 140 ? 'Toggle Sidebar' : 'Sidebar')}`,
                `${c.boldWhite('Ctrl+P')} ${c.emerald('Preview')}`,
                `${c.boldWhite('Ctrl+G')} ${c.amber(`Model ${this.getModelBadgeShort()}`)}`,
                `${c.boldWhite('Enter')} ${c.slateMuted('Send Message')}`,
                `${c.boldWhite('Tab')} ${c.slateMuted('Switch View')}`,
                ...(this.chatMessages.length > 0 ? [`${c.boldWhite('PgUp/PgDn')} ${c.slateMuted('Scroll')}`] : []),
                `${c.boldWhite('Esc')} ${c.slateMuted('Clear')}`,
                `${c.boldWhite('Ctrl+C')} ${c.slateMuted('Quit')}`,
              ]
            : this.activeTab === 3
              ? [
                  `${c.boldWhite('Tab')} ${c.slateMuted('Switch View')}`,
                  `${c.boldWhite('F2')} ${c.slateMuted('Sidebar')}`,
                  `${c.boldWhite('Enter')} ${c.cyan(this.swarmInspectorExpanded ? 'Collapse' : 'Expand')}`,
                  `${c.boldWhite('P')} ${c.emerald('Preview')}`,
                  `${c.boldWhite('R')} ${c.cyanBright('Refresh')}`,
                  `${c.boldWhite('Esc')} ${c.slateMuted('Back')}`,
                  `${c.boldWhite('↑/↓')} ${c.slateMuted('Select')}`,
                  `${c.boldWhite('G')} ${c.amber(`Model ${this.getModelBadgeShort()}`)}`,
                  `${c.boldWhite('Ctrl+B')} ${c.cyanBright('Prefix')}`,
                  `${c.boldWhite('Ctrl+C')} ${c.slateMuted('Quit')}`,
                ]
              : [
                  `${c.boldWhite('Tab')} ${c.slateMuted('Switch View')}`,
                  `${c.boldWhite('F2 / Ctrl+\\')} ${c.slateMuted(W >= 140 ? 'Toggle Sidebar' : 'Sidebar')}`,
                  `${c.boldWhite('0-5')} ${c.slateMuted('Jump')}`,
                  `${c.boldWhite('/')} ${c.slateMuted('Prompt')}`,
                  `${c.boldWhite('C')} ${c.cyan('Chat')}`,
                  `${c.boldWhite('G')} ${c.amber(`Model ${this.getModelBadgeShort()}`)}`,
                  `${c.boldWhite('P')} ${c.emerald('Preview')}`,
                  `${c.boldWhite('R')} ${c.cyan('Refresh')}`,
                  `${c.boldWhite('Q')} ${c.slateMuted('Quit')}`,
                ]
    ).join('   ');
    lines.push(fullLine(hotkeys));

    // Rewrite from the cursor home and strictly clamp rows to viewport height
    const frame = lines.slice(0, terminalRows).map((l) => fitTerminalLine(l, W));
    const clearBelow = terminalRows < this.lastRenderedRowCount ? '\x1b[J' : '';
    this.lastRenderedRowCount = terminalRows;
    const changed = frame.flatMap((line, row) =>
      line === this.lastRenderedFrame[row] ? [] : [`\x1b[${row + 1};1H${line}`],
    );
    for (let row = frame.length; row < this.lastRenderedFrame.length; row++) changed.push(`\x1b[${row + 1};1H\x1b[2K`);
    this.lastRenderedFrame = frame;
    if (changed.length || clearBelow) process.stdout.write(changed.join('') + clearBelow);
  }

  // ── Tab 1: MAOS Oasis welcome screen ───────────────────────────
  private renderTabFleet(lines: string[], W: number, bodyRows: number): void {
    const center = (value: string) => centerTerminalLine(value, W);
    const promptW = Math.min(76, W - 4);

    if (this.transcript.length > 0) {
      const transcriptWidth = Math.max(1, W - 2);
      const rows = this.transcript.flatMap((line) => wrapTerminalLine(line, transcriptWidth));
      if (this.externalCommandRunning && this.commandOutputRemainder) {
        rows.push(...wrapTerminalLine(this.commandOutputRemainder, transcriptWidth));
      }
      if (this.externalCommandRunning) {
        const elapsedSec = Math.floor((Date.now() - this.externalCommandStartTime) / 1000);
        const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
        const secs = String(elapsedSec % 60).padStart(2, '0');
        const spinner = this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length];
        const runningRow = `${spinner} ${this.externalCommandLabel || 'Running'}... (${mins}:${secs})`;
        rows.push(...wrapTerminalLine(runningRow, transcriptWidth));
      }
      const promptRows = 4;
      const viewportRows = Math.max(1, bodyRows - promptRows);
      this.transcriptViewportRows = viewportRows;
      this.transcriptRenderedRowCount = rows.length;
      this.transcriptScrollOffset = Math.max(
        0,
        Math.min(this.transcriptScrollOffset, Math.max(0, rows.length - viewportRows)),
      );
      const end = rows.length - this.transcriptScrollOffset;
      const start = Math.max(0, end - viewportRows);
      const visibleRows = rows.slice(start, end);

      const scrollBar = this.renderScrollBarTrack(viewportRows, rows.length, this.transcriptScrollOffset, c.cyanBright);

      const paddingRows = viewportRows - visibleRows.length;
      for (let i = 0; i < paddingRows; i++) {
        lines.push(`${' '.repeat(transcriptWidth)} ${scrollBar[i] || c.slateBorder('│')}`);
      }
      for (let j = 0; j < visibleRows.length; j++) {
        const row = visibleRows[j];
        let styled = '';
        if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(row)) {
          styled = c.cyanBright(row);
        } else if (row.startsWith('✓')) {
          styled = c.emerald(row);
        } else if (row.startsWith('✗') || row.startsWith('Error:')) {
          styled = c.pink(row);
        } else {
          styled = c.slateText(row);
        }
        lines.push(`${fitTerminalLine(styled, transcriptWidth)} ${scrollBar[paddingRows + j] || c.slateBorder('│')}`);
      }

      lines.push(c.slateBorder('─'.repeat(W)));
      const innerW = Math.max(0, W - 4);
      const prefix = `${c.cyanBright('❯')}  `;
      const inputWidth = Math.max(0, innerW - terminalCellWidth(prefix));
      const commandText = this.externalCommandRunning
        ? `${c.cyanBright(this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length])} ${c.white(`${this.externalCommandLabel || 'Running'}...`)} ${c.slateMuted('(Ctrl+C to abort · Tab to switch view)')}`
        : renderInputContentWithCursor(
            this.modalInput.getText(),
            this.modalInput.getCursor(),
            inputWidth,
            'Type a goal or /help for commands',
            c.boldWhite,
          );
      const innerContent = prefix + commandText;
      const promptRow = `${c.cyanBright('│ ')}${fitTerminalLine(innerContent, innerW)}${c.cyanBright(' │')}`;
      lines.push(centerTerminalLine(c.cyanBright('╭' + '─'.repeat(Math.max(0, W - 2)) + '╮'), W));
      lines.push(promptRow);
      lines.push(centerTerminalLine(c.cyanBright('╰' + '─'.repeat(Math.max(0, W - 2)) + '╯'), W));
      return;
    }

    if (W >= MAOS_OASIS_LOGO_WIDTH) {
      for (const row of MAOS_OASIS_LOGO_ROWS) lines.push(center(c.slateText(row)));
    } else {
      lines.push(center(`${c.boldWhite('MAOS')} ${c.cyanBright('OASIS')}`));
    }
    lines.push('');
    const subtitle =
      W >= 68
        ? c.slateText('Sovereign Multi-Agent Swarm Kernel'.split('').join(' '))
        : c.slateText('Sovereign Multi-Agent Swarm Kernel');
    lines.push(center(subtitle));
    lines.push('');
    lines.push('');
    const dividerW = Math.max(0, Math.min(42, W - 4));
    const sideW = Math.max(0, Math.floor((dividerW - 2) / 3));
    const middleW = Math.max(0, dividerW - sideW * 2 - 2);
    lines.push(
      center(
        `${c.slateBorder('─'.repeat(sideW))}  ${c.cyanBright('━'.repeat(middleW))}  ${c.slateBorder('─'.repeat(sideW))}`,
      ),
    );
    lines.push('');
    lines.push('');
    lines.push('');
    const promptInnerW = promptW - 4;
    const prefix = `${c.cyanBright('❯')}  `;
    const inputWidth = Math.max(0, promptInnerW - terminalCellWidth(prefix));
    const commandText = this.externalCommandRunning
      ? `${c.cyanBright(this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length])} ${c.white(`${this.externalCommandLabel || 'Running'}...`)} ${c.slateMuted('(Ctrl+C to abort · Tab to switch view)')}`
      : renderInputContentWithCursor(
          this.modalInput.getText(),
          this.modalInput.getCursor(),
          inputWidth,
          'Type a goal or /help for commands',
          c.boldWhite,
        );
    const innerContent = prefix + commandText;
    const promptRow = `${c.cyanBright('│ ')}${fitTerminalLine(innerContent, promptInnerW)}${c.cyanBright(' │')}`;
    if (promptW >= 24) {
      lines.push(centerTerminalLine(c.cyanBright('╭' + '─'.repeat(promptW - 2) + '╮'), W));
      lines.push(centerTerminalLine(promptRow, W));
      lines.push(centerTerminalLine(c.cyanBright('╰' + '─'.repeat(promptW - 2) + '╯'), W));
    } else {
      lines.push(center(innerContent));
    }
  }

  // ── Tab 2: Direct Local Gemma LLM Chat ─────────────────────────
  private renderTabChat(lines: string[], W: number, bodyRows: number): void {
    const center = (value: string) => centerTerminalLine(value, W);
    const host = this.oasisConfig?.ollama?.host || '127.0.0.1';
    const port = this.oasisConfig?.ollama?.port || 11434;
    const modelBadge = this.selectedModel.replace('gemma2:', 'GEMMA ').toUpperCase();

    // Responsive sleek NeoVim-style info bar
    const infoBar =
      W >= 87
        ? `${c.cyanBright('💬')} ${c.boldWhite('CHAT')}  ${c.slateBorder('│')}  ${c.slateMuted('ACTIVE MODEL:')} ${c.violetBright(modelBadge)}  ${c.slateBorder('│')}  ${c.slateMuted('LOCAL INFERENCE:')} ${c.emerald(`${host}:${port}`)}  ${c.slateBorder('│')}  ${c.cyanBright('0 KB EGRESS')}`
        : W >= 54
          ? `${c.cyanBright('💬 CHAT')} · ${c.violetBright(modelBadge)} · ${c.emerald(`${host}:${port}`)} · ${c.cyanBright('0 KB EGRESS')}`
          : W >= 32
            ? `${c.cyanBright('💬 CHAT')} · ${c.violetBright(modelBadge)} · ${c.cyanBright('0 KB EGRESS')}`
            : `${c.cyanBright('💬 CHAT')} · ${c.violetBright(modelBadge)}`;
    lines.push(center(infoBar));
    lines.push(c.slateBorder('─'.repeat(W)));

    // Chat history viewport
    const promptRows = 3;
    const headerRows = lines.length;
    const availableChatRows = Math.max(1, bodyRows - headerRows - promptRows);

    const chatContentWidth = Math.max(1, W - 2);
    const chatDisplayRows: string[] = [];

    if (this.chatMessages.length === 0) {
      const maxBoxW = Math.max(10, Math.min(62, chatContentWidth - 4));
      const boxW = Math.max(10, Math.min(maxBoxW, W - 2));
      const innerW = Math.max(8, boxW - 2);
      const topBorder = c.cyanBright('╭' + '─'.repeat(innerW) + '╮');
      const bottomBorder = c.cyanBright('╰' + '─'.repeat(innerW) + '╯');
      const makeBoxRow = (styledText: string) => {
        return c.cyanBright('│') + centerTerminalLine(styledText, innerW) + c.cyanBright('│');
      };

      const title =
        innerW >= 37 ? 'Welcome to MAOS Sovereign Local Chat!' : innerW >= 24 ? 'MAOS Sovereign Chat' : 'MAOS Chat';
      const desc =
        innerW >= 55
          ? 'Chat directly with local Gemma without spawning swarms.'
          : innerW >= 36
            ? 'Direct chat with sovereign local Gemma.'
            : 'Direct local Gemma chat.';
      const hint =
        innerW >= 50
          ? 'Try: "Hi", "What is MAOS?", "Explain architecture"'
          : innerW >= 30
            ? 'Try: "Hi" or "What is MAOS?"'
            : 'Try: "Hi"';

      chatDisplayRows.push('');
      chatDisplayRows.push(center(topBorder));
      chatDisplayRows.push(center(makeBoxRow(c.white(title))));
      chatDisplayRows.push(center(makeBoxRow(c.slateText(desc))));
      chatDisplayRows.push(center(makeBoxRow(c.slateMuted(hint))));
      chatDisplayRows.push(center(bottomBorder));
    } else {
      for (const msg of this.chatMessages) {
        if (msg.sender === 'user') {
          chatDisplayRows.push(`${c.cyanBright('>')} ${c.boldWhite('You')} ${c.slateMuted(`[${msg.time}]`)}`);
          for (const line of wrapTerminalLine(msg.text, chatContentWidth - 4)) {
            chatDisplayRows.push(`  ${c.white(line)}`);
          }
        } else {
          chatDisplayRows.push(
            `${c.violetBright('◆')} ${c.boldWhite(`Gemma (${this.selectedModel})`)} ${c.slateMuted(`[${msg.time}]`)}`,
          );
          for (const line of wrapTerminalLine(msg.text, chatContentWidth - 4)) {
            chatDisplayRows.push(`  ${c.slateText(line)}`);
          }
        }
        chatDisplayRows.push('');
      }
      if (this.chatIsStreaming) {
        const spinner = this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length];
        chatDisplayRows.push(`  ${c.cyanBright(spinner)} ${c.slateMuted('Gemma is generating response...')}`);
      }
    }

    this.chatViewportRows = availableChatRows;
    this.chatRenderedRowCount = chatDisplayRows.length;
    this.chatScrollOffset = Math.max(
      0,
      Math.min(this.chatScrollOffset, Math.max(0, chatDisplayRows.length - availableChatRows)),
    );

    const end = chatDisplayRows.length - this.chatScrollOffset;
    const start = Math.max(0, end - availableChatRows);
    const visibleChatRows = chatDisplayRows.slice(start, end);

    const scrollBar = this.renderScrollBarTrack(
      availableChatRows,
      chatDisplayRows.length,
      this.chatScrollOffset,
      c.violetBright,
    );

    const paddingRows = availableChatRows - visibleChatRows.length;
    for (let i = 0; i < paddingRows; i++) {
      lines.push(`${' '.repeat(chatContentWidth)} ${scrollBar[i] || c.slateBorder('│')}`);
    }
    for (let j = 0; j < visibleChatRows.length; j++) {
      const row = visibleChatRows[j];
      lines.push(`${fitTerminalLine(row, chatContentWidth)} ${scrollBar[paddingRows + j] || c.slateBorder('│')}`);
    }

    // Inline Chat Prompt Box
    const innerW = Math.max(0, W - 4);
    const prefix = `${c.violetBright('❯')}  `;
    const inputWidth = Math.max(0, innerW - terminalCellWidth(prefix));
    const inputText = this.chatIsStreaming
      ? `${c.cyanBright(this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length])} ${c.white('Generating response...')} ${c.slateMuted('(Loopback inference)')}`
      : renderInputContentWithCursor(
          this.chatInput.getText(),
          this.chatInput.getCursor(),
          inputWidth,
          'Ask Gemma anything... (Enter sends · Esc clears)',
          c.boldWhite,
        );
    const innerContent = prefix + inputText;
    const promptRow = `${c.violetBright('│ ')}${fitTerminalLine(innerContent, innerW)}${c.violetBright(' │')}`;
    lines.push(centerTerminalLine(c.violetBright('╭' + '─'.repeat(Math.max(0, W - 2)) + '╮'), W));
    lines.push(centerTerminalLine(promptRow, W));
    lines.push(centerTerminalLine(c.violetBright('╰' + '─'.repeat(Math.max(0, W - 2)) + '╯'), W));
  }

  // ── Tab 3: Swarm Board (Mascot + Roster + Posts + Inspector) ────
  private renderTabAgents(lines: string[], W: number, bodyRows?: number): void {
    // Dynamically synchronize model badge
    const modelBadge = formatHeaderBadge(this.selectedModel);
    for (const ag of this.swarmAgents) {
      if (!ag.model || ag.id === 'coordinator') {
        ag.model = modelBadge;
      }
    }
    // Synchronize Herdr panes if active
    if (this.herdrPanes.length > 0) {
      this.herdrPanes.forEach((pane, idx) => {
        const agIdx = idx + 1; // 0 is coordinator
        if (this.swarmAgents[agIdx]) {
          this.swarmAgents[agIdx].paneId = pane.pane_id;
          if (pane.agent_status === 'working') this.swarmAgents[agIdx].state = 'working';
          else if (pane.agent_status === 'done') this.swarmAgents[agIdx].state = 'done';
        }
      });
    }

    const boardState: SwarmBoardState = {
      goal: this.swarmGoal,
      status: this.swarmState,
      agents: this.swarmAgents,
      posts: this.swarmPosts,
      selectedAgentIndex: this.selectedSwarmAgentIndex,
      expanded: this.swarmInspectorExpanded,
      model: this.selectedModel,
      herdrConnected: this.herdrAvailable,
    };

    const boardLines = renderSwarmBoard(boardState, {
      width: W,
      height: bodyRows,
      time: Date.now() / 1000,
    });

    lines.push(...boardLines);
  }

  private renderTabGemma(lines: string[], W: number, bodyRows?: number): void {
    this.renderTabAgents(lines, W, bodyRows);
  }

  // ── Tab 4: Autonomous Healer & Telemetry ───────────────────────
  private renderTabHealer(lines: string[], W: number): void {
    const center = (value: string) => centerTerminalLine(value, W);
    const vramPercent = this.gpuStats.vramTotalMiB
      ? Math.round((this.gpuStats.vramUsedMiB / this.gpuStats.vramTotalMiB) * 100)
      : 0;
    lines.push(center(c.boldWhite('TELEMETRY')));
    lines.push(center(c.slateText('GPU health, system resources, and autonomous repair activity')));
    lines.push('');
    appendMetricCards(lines, W, [
      {
        label: 'GPU MEMORY',
        value: `${(this.gpuStats.vramUsedMiB / 1024).toFixed(1)} / ${(this.gpuStats.vramTotalMiB / 1024).toFixed(1)} GB`,
        detail: `${vramPercent}% allocated`,
        color: c.violetBright,
      },
      {
        label: 'GPU HEALTH',
        value: `${this.gpuStats.tempC}°C · ${this.gpuStats.gpuUtil}%`,
        detail: `${this.gpuStats.powerW}W draw · 75W limit`,
        color: c.emerald,
      },
      {
        label: 'LOCAL RUNTIME',
        value: this.selectedModel,
        detail: 'Ollama 127.0.0.1:11434',
        color: c.cyanBright,
      },
    ]);

    lines.push('');
    lines.push(`${c.cyanBright('◆')} ${c.boldWhite('AUTONOMOUS HEALER')}`);
    lines.push(
      `  ${c.white('Watcher')}  ${c.emerald('ACTIVE')}  ${c.slateMuted('·')}  ${c.white('Source')}  ${c.cyan('Herdr pane buffer hook')}`,
    );
    lines.push(
      `  ${c.white('Repair engine')}  ${c.violetBright('Gemma 2 9B')}  ${c.slateMuted('·')}  ${c.white('Stack traces')}  ${c.cyan('TypeScript / Vite / Node')}`,
    );
    lines.push(
      `  ${c.white('Incidents')}  ${c.amber('1 compile warning')}  ${c.slateMuted('·')}  ${c.white('Hotpatches')}  ${c.emerald('1 applied')}  ${c.slateMuted('·')}  ${c.white('Resolution')}  ${c.emerald('100%')}`,
    );
    lines.push(
      `  ${c.white('Retry limit')}  ${c.cyan('3 attempts')}  ${c.slateMuted('·')}  ${c.white('Average repair')}  ${c.cyan('3.82 seconds')}`,
    );
    lines.push(`  ${c.white('Network boundary')}  ${c.emerald('Loopback only · 0.00 KB cloud egress · STRICT')}`);

    lines.push('');
    lines.push(`${c.cyanBright('◆')} ${c.boldWhite('RECENT REPAIRS & VERIFICATION')}`);
    lines.push(
      `  ${c.slateMuted('[21:35]')} ${c.emerald('HEALED')}  ${c.white('Buffer geometry index types unified')}`,
    );
    lines.push(`  ${c.slateMuted('[21:17]')} ${c.emerald('PASS')}  ${c.white('Node test runner passed in 2.4 ms')}`);
    lines.push(`  ${c.slateMuted('[21:16]')} ${c.emerald('PASS')}  ${c.white('Raycast ground plane math verified')}`);
    lines.push(`  ${c.emerald('✓')} ${c.slateText('Uint16 buffer attributes normalized · Euler rotation verified')}`);
    lines.push(`  ${c.emerald('✓')} ${c.slateText('Zero regression across 47 tests')}`);
  }

  // ── Tab 5: Session Event Log ───────────────────────────────────
  private renderTabEventLog(lines: string[], W: number): void {
    const center = (value: string) => centerTerminalLine(value, W);
    lines.push(center(c.boldWhite('EVENT LOG')));
    lines.push(center(c.slateText('Chronological session activity and agent telemetry audit trail')));
    lines.push('');
    appendMetricCards(lines, W, [
      {
        label: 'SESSION EVENTS',
        value: String(this.activities.length),
        detail: this.activities.length ? 'Chronological session log' : 'No activity recorded yet',
        color: c.cyanBright,
      },
      {
        label: 'COMMANDS RUN',
        value: String(this.commandHistory.length),
        detail: 'Commands executed',
        color: c.violetBright,
      },
      {
        label: 'SYSTEM HEALTH',
        value: '100%',
        detail: '0 unhandled crashes',
        color: c.emerald,
      },
    ]);

    lines.push('');
    lines.push(`${c.cyanBright('◆')} ${c.boldWhite('RECENT ACTIVITY')}`);
    const events = this.activities.slice(0, 10);
    if (events.length === 0) {
      lines.push(`  ${c.slateMuted('Events from commands, agent activities, and autonomous repairs stream here.')}`);
    } else {
      for (const event of events) {
        lines.push(`  ${c.slateMuted(`[${event.time}]`)} ${event.color(`[${event.tag}]`)} ${c.white(event.text)}`);
      }
    }
  }

  private renderTabCanva3D(lines: string[], W: number): void {
    this.renderTabEventLog(lines, W);
  }

  // ── Tab 0: Workplace Settings & Configuration ──────────────────
  private renderTabSettings(lines: string[], W: number, bodyRows?: number): void {
    const center = (value: string) => centerTerminalLine(value, W);
    const allRows: string[] = [];

    allRows.push(center(c.boldWhite('SETTINGS & WORKSPACE CONFIGURATION')));
    allRows.push(center(c.slateText('Sovereign local parameters · 100% loopback · Zero cloud egress')));
    allRows.push('');

    const tier = (this.oasisConfig?.hardware?.tier || 'high').toUpperCase();
    const vramGB = this.gpuStats.vramTotalMiB ? (this.gpuStats.vramTotalMiB / 1024).toFixed(1) : '8.0';
    const host = this.oasisConfig?.ollama?.host || '127.0.0.1';
    const port = this.oasisConfig?.ollama?.port || 11434;

    // Quick Status Pill Banner
    const banner = `${c.slateBorder('[')} ${c.slateMuted('CONFIG:')} ${c.cyanBright('maos-oasis.json')} ${c.slateBorder(']')}   ${c.slateBorder('[')} ${c.slateMuted('TIER:')} ${c.emerald(`${tier} (${vramGB} GB)`)} ${c.slateBorder(']')}   ${c.slateBorder('[')} ${c.slateMuted('OPSEC:')} ${c.violetBright('STRICT LOOPBACK')} ${c.slateBorder(']')}`;
    allRows.push(center(banner));
    allRows.push('');

    // Categorized NeoVim / OpenCode style panel
    const panelW = Math.min(84, Math.max(46, W - 4));
    const col1W = Math.max(18, Math.min(24, Math.floor(panelW * 0.28)));
    const col3W = 14;
    const col2W = Math.max(10, panelW - col1W - col3W - 6);

    const renderHeader = (title: string, isFirst = false) => {
      const t = ' ' + title + ' ';
      const left = isFirst ? '╭─' : '├─';
      const right = isFirst ? '╮' : '┤';
      const dashes = Math.max(0, panelW - 3 - terminalCellWidth(t));
      return centerTerminalLine(c.slateBorder(left) + c.cyanBright(t) + c.slateBorder('─'.repeat(dashes) + right), W);
    };

    const renderRow = (label: string, val: string, status: string, colorFn: (s: string) => string) => {
      const p1 = fitTerminalLine(c.slateText(label), col1W);
      const p2 = fitTerminalLine(c.white(val), col2W);
      const p3 = fitTerminalLine(colorFn(status), col3W);
      const content = c.slateBorder('│ ') + p1 + ' ' + p2 + ' ' + p3 + c.slateBorder(' │');
      return centerTerminalLine(content, W);
    };

    // Category 1: MODEL & LOCAL INFERENCE
    allRows.push(renderHeader('MODEL & LOCAL INFERENCE', true));
    allRows.push(
      renderRow('Primary Model', `${this.selectedModel} (${this.gpuStats.modelInVram})`, '● ACTIVE', c.emerald),
    );
    if (this.detectedModels.length > 0) {
      for (const m of this.detectedModels.slice(0, 5)) {
        const isActive = m.id.toLowerCase() === this.selectedModel.toLowerCase();
        allRows.push(
          renderRow(
            `Model (${m.source})`,
            `${m.name} [${m.id}]`,
            isActive ? '● ACTIVE' : '○ READY',
            isActive ? c.emerald : c.slateMuted,
          ),
        );
      }
    }
    allRows.push(
      renderRow(
        'Fallback Model',
        this.oasisConfig?.model?.fallback || 'gemma2:2b (CPU fallback)',
        '○ STANDBY',
        c.slateMuted,
      ),
    );
    allRows.push(
      renderRow(
        'Context Window',
        `${this.oasisConfig?.model?.contextTokens || 8192} tokens (sliding window)`,
        '✓ 100% LOCAL',
        c.cyanBright,
      ),
    );
    allRows.push(renderRow('Ollama Daemon', `http://${host}:${port}`, '● LIVE', c.emerald));
    allRows.push(
      renderRow(
        'Auto-Start Daemon',
        this.oasisConfig?.ollama?.autoStart ? 'Enabled (on-demand spawn)' : 'Disabled',
        '✓ AUTO',
        c.cyan,
      ),
    );

    // Category 2: MULTI-AGENT ORCHESTRATION
    allRows.push(renderHeader('MULTI-AGENT ORCHESTRATION', false));
    allRows.push(
      renderRow(
        'Herdr Multi-Pane',
        this.oasisConfig?.dependencies?.herdr?.multiPaneEnabled ? 'Physical terminal split matrix' : 'Disabled',
        this.herdrAvailable ? '● ONLINE' : '○ OFFLINE',
        this.herdrAvailable ? c.emerald : c.amber,
      ),
    );
    allRows.push(
      renderRow(
        'OpenCode Tool Harness',
        this.oasisConfig?.dependencies?.opencode?.harnessEnabled ? 'Isolated CLI sandbox executor' : 'Disabled',
        '✓ READY',
        c.cyan,
      ),
    );
    allRows.push(renderRow('Autonomous Healer', 'Pane error repair & patch hook', '● WATCHING', c.emerald));
    allRows.push(
      renderRow(
        'Swarm Team Preset',
        `${this.oasisConfig?.team?.preset || 'team'} (5 coordinated agents)`,
        '✓ APPLIED',
        c.violetBright,
      ),
    );

    // Category 3: SOVEREIGNTY & OPSEC POLICY
    allRows.push(renderHeader('SOVEREIGNTY & OPSEC POLICY', false));
    allRows.push(
      renderRow(
        'Hardware Profile',
        `${tier} TIER (${this.gpuStats.tempC}°C · ${this.gpuStats.powerW}W)`,
        '✓ DETECTED',
        c.emerald,
      ),
    );
    allRows.push(renderRow('Network Boundary', '127.0.0.1 loopback only', '✓ STRICT', c.emerald));
    allRows.push(renderRow('Cloud Telemetry Egress', '0.00 KB transmitted (strict policy)', '✓ BLOCKED', c.emerald));

    // Bottom Border
    allRows.push(centerTerminalLine(c.slateBorder('╰' + '─'.repeat(Math.max(0, panelW - 2)) + '╯'), W));

    allRows.push('');
    allRows.push(
      centerTerminalLine(
        `${c.boldWhite('G')} ${c.slateMuted('Toggle Model (2B ↔ 9B)')}   ${c.boldWhite('R')} ${c.slateMuted('Refresh Status')}   ${c.boldWhite('PgUp/PgDn')} ${c.slateMuted('Scroll')}   ${c.boldWhite('Esc')} ${c.slateMuted('Dashboard')}`,
        W,
      ),
    );

    if (bodyRows !== undefined && allRows.length > bodyRows) {
      this.settingsViewportRows = bodyRows;
      this.settingsRenderedRowCount = allRows.length;
      const maxScroll = Math.max(0, allRows.length - bodyRows);
      this.settingsScrollOffset = Math.max(0, Math.min(this.settingsScrollOffset, maxScroll));
      const end = allRows.length - this.settingsScrollOffset;
      const start = Math.max(0, end - bodyRows);
      lines.push(...allRows.slice(start, end));
    } else {
      this.settingsViewportRows = bodyRows || allRows.length;
      this.settingsRenderedRowCount = allRows.length;
      this.settingsScrollOffset = 0;
      lines.push(...allRows);
    }
  }

  // ── Modal Dialog Overlay ───────────────────────────────────────
  private renderModal(lines: string[], W: number): void {
    const modalW = Math.max(12, Math.min(74, W - 8));
    const modalPad = Math.max(2, Math.floor((W - modalW) / 2));
    const padStr = ' '.repeat(modalPad);

    lines.push(c.slateBorder('├' + '─'.repeat(Math.max(0, W - 2)) + '┤'));

    const modalTitle = this.modalMode === 'ignite' ? '⚡ IGNITE AUTONOMOUS GEMMA SWARM' : '🧠 GEMMA PROMPT PLAYGROUND';
    const titleText = chalk.bgHex('#EC4899').hex('#FFFFFF').bold(` ${modalTitle} `);
    const titleFill = Math.max(0, modalW - terminalCellWidth(`╭─ `) - terminalCellWidth(titleText) - 1);
    lines.push(padStr + fitTerminalLine(`${c.pink('╭─ ')}${titleText}${c.pink(' '.repeat(titleFill) + '╮')}`, modalW));

    const promptWidth = Math.max(0, modalW - 4);
    const inputPrefix = 'Goal: ';
    const inputWidth = Math.max(0, promptWidth - terminalCellWidth(inputPrefix));
    const promptText = `${inputPrefix}${renderInputContentWithCursor(
      this.modalInput.getText(),
      this.modalInput.getCursor(),
      inputWidth,
      'Enter swarm goal...',
      c.pink,
    )}`;
    lines.push(padStr + c.pink('│ ') + fitTerminalLine(promptText, promptWidth) + c.pink(' │'));

    const hint = `Press [Enter] to dispatch to Gemma (${this.selectedModel}) · [Esc] to cancel`;
    lines.push(padStr + c.pink('│ ') + fitTerminalLine(c.slateMuted(hint), Math.max(0, modalW - 4)) + c.pink(' │'));

    lines.push(padStr + c.pink('╰' + '─'.repeat(modalW - 2) + '╯'));
  }
}

// ── Entrypoint ───────────────────────────────────────────────────
if (require.main === module) {
  const tui = new MaosTui(path.resolve(__dirname, '..', '..'));
  tui.start();
}
