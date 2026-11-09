/**
 * MAOS OpenCode + Gemma Model Harness Provider
 *
 * Delegates MAOS tasks to Gemma / Qwen local models THROUGH the OpenCode
 * execution harness:
 *
 *   - MAOS is the Orchestrator (task DAGs, worktrees, telemetry).
 *   - Herdr is the Terminal Multiplexer (panes, processes, buffers).
 *   - OpenCode is the Model Harness (AST parsing, LSP navigation,
 *     file editing, file diffing, bash execution, tool calling loop).
 *   - Gemma / Qwen is the Sovereign Intelligence (reasoning + diffs).
 *
 * Transport:
 *   - Primary: Ollama / llama.cpp OpenAI-compatible endpoint at
 *     http://localhost:11434/v1 (loopback-only, zero cloud traces).
 *   - Fallback: `opencode run` CLI with the same local model selected.
 *
 * This class implements IProvider so it drops straight into
 * RuntimeFactory / ApiRuntime / agent-runner with zero core changes:
 *
 * ```ts
 * import { createOpenCodeGemmaProvider } from './opencode-gemma-provider';
 * const provider = createOpenCodeGemmaProvider({ model: 'gemma2:9b' });
 * const runtime = new ApiRuntime({ provider, role: 'coder', ... }, bus);
 * ```
 *
 * OpSec: loopback-only endpoints. Any non-loopback baseURL throws.
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  IProvider,
  ChatMessage,
  ToolDef,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamOptions,
} from './provider';
import { OpenAIProvider } from './openai-provider';

// ─── Endpoint + model catalog ───────────────────────────────────

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';
export const DEFAULT_LLAMACPP_BASE_URL = 'http://localhost:8080/v1';

export interface GemmaModelSpec {
  /** Ollama tag, e.g. "gemma2:2b" */
  tag: string;
  /** Approx VRAM for Q4_K_M quant */
  vram: string;
  /** Intended role in the 8GB envelope */
  role: string;
}

export const OPENCODE_GEMMA_MODELS: Record<string, GemmaModelSpec> = {
  'gemma2:2b': { tag: 'gemma2:2b', vram: '~1.8 GB Q4_K_M', role: 'triage / task-decomposition, 70+ tok/s' },
  'gemma2:9b': { tag: 'gemma2:9b', vram: '~5.2 GB Q4_K_M', role: 'primary reasoning / codegen' },
  'gemma3:4b': { tag: 'gemma3:4b', vram: '~2.8 GB Q4_K_M', role: 'balanced triage + codegen' },
  'qwen2.5-coder:7b': { tag: 'qwen2.5-coder:7b', vram: '~5.8 GB Q4_K_M', role: 'fallback coder engine' },
  'qwen2.5-coder:1.5b': { tag: 'qwen2.5-coder:1.5b', vram: '~1.2 GB Q4_K_M', role: 'ultra-fast triage fallback' },
};

export const DEFAULT_GEMMA_MODEL = 'gemma2:9b';
export const FALLBACK_QWEN_MODEL = 'qwen2.5-coder:7b';

// ─── Config ─────────────────────────────────────────────────────

export interface OpenCodeGemmaConfig {
  /** Model tag. Defaults to gemma2:9b. */
  model?: string;
  /** Ollama / llama.cpp OpenAI-compat base URL. Must be loopback. */
  baseURL?: string;
  /** Local runners need no key; kept for IProvider compat. */
  apiKey?: string;
  /** Sampling temperature. Small local models do best near 0.2. */
  temperature?: number | null;
  /** Request timeout ms. */
  timeout?: number;
  /** Max retries on transient transport errors. */
  maxRetries?: number;
  /** `opencode` binary for CLI fallback. Defaults to "opencode". */
  opencodeBinary?: string;
  /** Display name override. */
  name?: string;
  /** Extra fetch impl (tests). */
  fetch?: typeof globalThis.fetch;
}

// ─── OpenCode harness system addendum ───────────────────────────
// Injected ahead of the agent loop so the small local model uses
// OpenCode-style discipline: read first, diff explicitly, use tools.

export const OPENCODE_HARNESS_ADDENDUM = [
  '## OpenCode Harness Discipline (Gemma / Qwen local)',
  '- You run inside the OpenCode model harness. You have AST-aware file reads,',
  '  precise file diffing, and a bash/tool execution loop. Use them every iteration.',
  '- FIRST read_file + list_dir + search_code to ground yourself. Never guess APIs.',
  '- Before write_file, state the exact diff intent (file, lines, behavior change).',
  '- After write_file, run_command (tsc / tests / build) to verify. Fix failures',
  '  before calling task_complete. Red output is a repair signal, not a stop signal.',
  '- Keep edits scoped to the task branch and allowed scope. Do not touch other panes\' worktrees.',
  '- Prefer small verifiable patches over large rewrites. Commit with git_commit when green.',
].join('\n');

function isLoopbackURL(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function assertLoopback(baseURL: string, providerName: string): void {
  if (!isLoopbackURL(baseURL)) {
    throw new Error(
      `Provider "${providerName}" must use a loopback endpoint in sovereign-local mode. ` +
        `Got "${baseURL}". Use ${DEFAULT_OLLAMA_BASE_URL} (Ollama) or ${DEFAULT_LLAMACPP_BASE_URL} (llama.cpp).`,
    );
  }
}

// ─── Provider ───────────────────────────────────────────────────

export class OpenCodeGemmaProvider implements IProvider {
  readonly name: string;
  readonly model: string;
  readonly baseURL: string;
  readonly harness = 'opencode' as const;

  private readonly inner: OpenAIProvider;
  private readonly opencodeBinary: string;

  constructor(config: OpenCodeGemmaConfig = {}) {
    const model = config.model || DEFAULT_GEMMA_MODEL;
    const baseURL = config.baseURL || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
    assertLoopback(baseURL, config.name || 'opencode-gemma');

    this.name = config.name || 'opencode-gemma';
    this.model = model;
    this.baseURL = baseURL;
    this.opencodeBinary = config.opencodeBinary || process.env.OPENCODE_BINARY || 'opencode';

    this.inner = new OpenAIProvider({
      name: this.name,
      apiKey: config.apiKey || 'local',
      model: this.model,
      baseURL: this.baseURL,
      timeout: config.timeout ?? 180_000,
      maxRetries: config.maxRetries ?? 2,
      temperature: Object.prototype.hasOwnProperty.call(config, 'temperature') ? (config.temperature ?? null) : 0.2,
      fetch: config.fetch,
    });
  }

  /**
   * Inject the OpenCode harness discipline into the conversation.
   * Idempotent: skips injection when the system prompt already mentions it.
   */
  withHarness(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) return messages;
    const first = messages[0];
    if (first.role === 'system' && typeof first.content === 'string') {
      if (first.content.includes('OpenCode Harness Discipline')) return messages;
      return [{ ...first, content: `${first.content}\n\n${OPENCODE_HARNESS_ADDENDUM}` }, ...messages.slice(1)];
    }
    return [{ role: 'system', content: OPENCODE_HARNESS_ADDENDUM }, ...messages];
  }

  async generate(messages: ChatMessage[], tools?: ToolDef[], options?: ProviderRequestOptions): Promise<ProviderResponse> {
    return this.inner.generate(this.withHarness(messages), tools, options);
  }

  async generateStream(
    messages: ChatMessage[],
    tools?: ToolDef[],
    options?: ProviderStreamOptions,
  ): Promise<ProviderResponse> {
    if (typeof this.inner.generateStream !== 'function') {
      return this.generate(messages, tools, options);
    }
    return this.inner.generateStream(this.withHarness(messages), tools, options);
  }

  // ── OpenCode harness capabilities (for scheduler / diagnostics) ──

  /** Static capability declaration for the MAOS scheduler. */
  getCapabilityProfile(): {
    harness: 'opencode';
    supportsTools: boolean;
    supportsCodeMutation: boolean;
    supportsStreaming: boolean;
    supportsParallelism: boolean;
    localOnly: boolean;
    astParsing: boolean;
    fileDiffing: boolean;
    toolExecution: boolean;
  } {
    return {
      harness: 'opencode',
      supportsTools: true,
      supportsCodeMutation: true,
      supportsStreaming: true,
      supportsParallelism: false,
      localOnly: true,
      astParsing: true,
      fileDiffing: true,
      toolExecution: true,
    };
  }

  /**
   * Probe the local endpoint (GET <baseURL>/models). Returns true when
   * Ollama / llama.cpp answers on loopback. Never touches the network
   * beyond 127.0.0.1 / localhost.
   */
  async isLocalEndpointAvailable(timeoutMs = 5_000): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = this.baseURL.replace(/\/$/, '') + '/models';
      const res = await (globalThis.fetch as typeof fetch)(url, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Build an `opencode run` CLI fallback command for a saved prompt file.
   * Used when the HTTP endpoint is down but the OpenCode CLI is installed
   * with the same local model configured.
   */
  buildOpenCodeCliCommand(promptFile: string, extraArgs: string[] = []): { command: string; args: string[] } {
    if (!/^[a-zA-Z0-9_.-]+$/.test(this.opencodeBinary.replace(/\.cmd$|\.exe$/, ''))) {
      throw new Error(`Security Violation: invalid opencode binary '${this.opencodeBinary}'`);
    }
    for (const arg of extraArgs) {
      if (/[;&|`$()]/.test(arg)) throw new Error(`Security Violation: dangerous CLI argument '${arg}'`);
    }
    const absolutePrompt = path.isAbsolute(promptFile) ? promptFile : path.resolve(promptFile);
    return {
      command: this.opencodeBinary,
      args: ['run', '-f', absolutePrompt, '--model', this.model, ...extraArgs],
    };
  }

  /**
   * CLI fallback: pipe a prompt string through `opencode run -f <tmpfile>`.
   * Spawns synchronously under the project root so file tools resolve
   * against the agent worktree. Returns stdout on success.
   */
  runViaOpenCodeCli(prompt: string, projectRoot: string, extraArgs: string[] = []): string {
    const tmpDir = path.join(projectRoot, '.maos', 'prompts');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `opencode-gemma-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, prompt, 'utf-8');
    const { command, args } = this.buildOpenCodeCliCommand(tmpFile, extraArgs);
    const out = child_process.spawnSync(command, args, {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 300_000,
      shell: false,
    });
    if (out.error) throw out.error;
    if (out.status !== 0) {
      throw new Error(`opencode CLI failed (exit ${out.status}): ${(out.stderr || out.stdout || '').substring(0, 2000)}`);
    }
    return out.stdout || '';
  }
}

// ─── Factories ──────────────────────────────────────────────────

/** Create a Gemma-primary provider (Ollama default). */
export function createOpenCodeGemmaProvider(config: OpenCodeGemmaConfig = {}): OpenCodeGemmaProvider {
  return new OpenCodeGemmaProvider({ model: DEFAULT_GEMMA_MODEL, ...config });
}

/** Create the Qwen fallback provider for the dual-model agility strategy. */
export function createOpenCodeQwenFallbackProvider(config: OpenCodeGemmaConfig = {}): OpenCodeGemmaProvider {
  return new OpenCodeGemmaProvider({ model: FALLBACK_QWEN_MODEL, name: 'opencode-qwen', ...config });
}

/**
 * Register both providers with the MAOS plugin registry so
 * maos.config.json can reference `"provider": "opencode-gemma"`.
 * Safe to call multiple times.
 */
export function registerOpenCodeGemmaProviders(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPluginRegistry } = require('./plugin-registry') as typeof import('./plugin-registry');
    const registry = getPluginRegistry();
    if (!registry.hasProvider('opencode-gemma')) {
      registry.registerProvider(
        'opencode-gemma',
        (cfg) =>
          createOpenCodeGemmaProvider({
            model: typeof cfg['model'] === 'string' ? (cfg['model'] as string) : DEFAULT_GEMMA_MODEL,
            baseURL: typeof cfg['baseURL'] === 'string' ? (cfg['baseURL'] as string) : undefined,
            apiKey: typeof cfg['apiKey'] === 'string' ? (cfg['apiKey'] as string) : undefined,
          }),
        { name: 'opencode-gemma', version: '1.0.0', type: 'provider', description: 'OpenCode harness + local Gemma via Ollama' },
      );
    }
    if (!registry.hasProvider('opencode-qwen')) {
      registry.registerProvider(
        'opencode-qwen',
        (cfg) =>
          createOpenCodeQwenFallbackProvider({
            model: typeof cfg['model'] === 'string' ? (cfg['model'] as string) : FALLBACK_QWEN_MODEL,
            baseURL: typeof cfg['baseURL'] === 'string' ? (cfg['baseURL'] as string) : undefined,
            apiKey: typeof cfg['apiKey'] === 'string' ? (cfg['apiKey'] as string) : undefined,
          }),
        { name: 'opencode-qwen', version: '1.0.0', type: 'provider', description: 'OpenCode harness + local Qwen fallback via Ollama' },
      );
    }
  } catch {
    /* plugin registry unavailable in this context — non-fatal */
  }
}
