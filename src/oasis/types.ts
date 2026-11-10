/**
 * MAOS Oasis — Autonomous Sovereign Workplace Types & Interfaces
 *
 * Defines contracts for:
 *   - Core workplace configuration (`maos-oasis.config.json`)
 *   - Hardware detection profiles and tier boundaries
 *   - Gemma model matrix (Gemma 2, Gemma 3, and experimental Gemma 4 tags)
 *   - Doctor diagnostic results and health reports
 *   - Agent team presets (solo, duo, team)
 */

// ── Hardware Tiers & Profiles ──────────────────────────────────────────────

export type HardwareTier = 'low' | 'mid' | 'high' | 'ultra';

export interface HardwareProfile {
  readonly gpuName: string;
  readonly vramMB: number;
  readonly tier: HardwareTier;
  readonly isNvidia: boolean;
  readonly isAmd: boolean;
  readonly isCpuOnly: boolean;
  readonly totalRamMB: number;
  readonly driverVersion?: string;
  readonly cpuCores?: number;
}

export const HARDWARE_TIER_THRESHOLDS = Object.freeze({
  LOW_MAX_VRAM_MB: 4096, // < 4GB VRAM or CPU-only
  MID_MAX_VRAM_MB: 6144, // 4GB - 6GB VRAM
  HIGH_MAX_VRAM_MB: 12288, // 6GB - 12GB VRAM (e.g. RTX 4060 8GB = 8188 MB)
  // >= 12288 MB is ULTRA
});

// ── Gemma Model Catalog & Matrix ───────────────────────────────────────────

export interface GemmaModelSpec {
  readonly tag: string;
  readonly name: string;
  readonly tier: HardwareTier;
  readonly minVramMB: number;
  readonly recommendedContextTokens: number;
  readonly isGemma4?: boolean;
  readonly isDefault?: boolean;
  readonly description: string;
  readonly vramFootprintText: string;
}

export const GEMMA_MODEL_CATALOG: Record<string, GemmaModelSpec> = Object.freeze({
  'gemma2:9b': {
    tag: 'gemma2:9b',
    name: 'Gemma 2 9B (Instruct)',
    tier: 'high',
    minVramMB: 6144,
    recommendedContextTokens: 8192,
    isDefault: true,
    description: 'Primary reasoning and codegen engine for 6-8GB VRAM (RTX 4060)',
    vramFootprintText: '~5.4 GB VRAM (Q4_K_M)',
  },
  'gemma2:2b': {
    tag: 'gemma2:2b',
    name: 'Gemma 2 2B (Instruct)',
    tier: 'low',
    minVramMB: 0,
    recommendedContextTokens: 4096,
    isDefault: false,
    description: 'Lightweight triage and low-memory fallback for CPU or <4GB VRAM',
    vramFootprintText: '~1.8 GB VRAM (Q4_0)',
  },
  'gemma3:4b': {
    tag: 'gemma3:4b',
    name: 'Gemma 3 4B',
    tier: 'mid',
    minVramMB: 4096,
    recommendedContextTokens: 8192,
    isDefault: false,
    description: 'Balanced triage and codegen for 4-6GB VRAM systems',
    vramFootprintText: '~2.8 GB VRAM (Q4_K_M)',
  },
  'gemma4:e2b': {
    tag: 'gemma4:e2b',
    name: 'Gemma 4 e2B (Experimental)',
    tier: 'low',
    minVramMB: 0,
    recommendedContextTokens: 4096,
    isGemma4: true,
    description: 'Next-gen experimental lightweight Gemma 4 edge model',
    vramFootprintText: '~1.6 GB VRAM',
  },
  'gemma4:e4b': {
    tag: 'gemma4:e4b',
    name: 'Gemma 4 e4B (Experimental)',
    tier: 'mid',
    minVramMB: 4096,
    recommendedContextTokens: 8192,
    isGemma4: true,
    description: 'Next-gen experimental mid-weight Gemma 4 model for 4-8GB VRAM',
    vramFootprintText: '~3.2 GB VRAM',
  },
});

export const DEFAULT_PRIMARY_MODEL = 'gemma2:9b';
export const DEFAULT_FALLBACK_MODEL = 'gemma2:2b';

/**
 * Resolves the recommended Gemma models given a hardware tier.
 */
export function resolveRecommendedGemmaModel(tier: HardwareTier): {
  primary: string;
  fallback: string;
  contextTokens: number;
} {
  switch (tier) {
    case 'ultra':
    case 'high':
      return {
        primary: 'gemma2:9b',
        fallback: 'gemma2:2b',
        contextTokens: 8192,
      };
    case 'mid':
      return {
        primary: 'gemma3:4b',
        fallback: 'gemma2:2b',
        contextTokens: 8192,
      };
    case 'low':
    default:
      return {
        primary: 'gemma2:2b',
        fallback: 'gemma2:2b',
        contextTokens: 4096,
      };
  }
}

/**
 * Checks if a given tag is a recognized Gemma model in the Oasis matrix.
 */
export function isGemmaModelTag(tag: string): boolean {
  return tag in GEMMA_MODEL_CATALOG;
}

// ── Agent Team Presets ─────────────────────────────────────────────────────

export type TeamPresetId = 'solo' | 'duo' | 'team';

export interface TeamPresetMember {
  readonly role: 'orchestrator' | 'lead' | 'worker' | 'reviewer' | 'coder';
  readonly slot: 'leadModel' | 'workerModel' | 'reviewerModel';
  readonly title: string;
  readonly description: string;
}

export interface TeamPresetConfig {
  readonly id: TeamPresetId;
  readonly name: string;
  readonly description: string;
  readonly members: readonly TeamPresetMember[];
  readonly defaultLeadModelSlot: string;
  readonly defaultWorkerModelSlot: string;
  readonly defaultReviewerModelSlot: string;
}

export const TEAM_PRESETS: Record<TeamPresetId, TeamPresetConfig> = Object.freeze({
  solo: {
    id: 'solo',
    name: 'Solo Coder (1 Agent)',
    description: 'Single autonomous agent executing task planning, coding, and verification sequentially.',
    members: [
      {
        role: 'worker',
        slot: 'workerModel',
        title: 'Autonomous Coder',
        description: 'Handles end-to-end task decomposition, file editing, and testing.',
      },
    ],
    defaultLeadModelSlot: 'workerModel',
    defaultWorkerModelSlot: 'workerModel',
    defaultReviewerModelSlot: 'workerModel',
  },
  duo: {
    id: 'duo',
    name: 'Pair Programming (2 Agents)',
    description: 'Lead planner/architect pairs with reviewer/verifier to critique code diffs before commits.',
    members: [
      {
        role: 'lead',
        slot: 'leadModel',
        title: 'Lead Architect',
        description: 'Designs specifications, plans tasks, and generates implementations.',
      },
      {
        role: 'reviewer',
        slot: 'reviewerModel',
        title: 'Reviewer / QA',
        description: 'Audits diffs, runs test suites, and enforces code quality.',
      },
    ],
    defaultLeadModelSlot: 'leadModel',
    defaultWorkerModelSlot: 'leadModel',
    defaultReviewerModelSlot: 'reviewerModel',
  },
  team: {
    id: 'team',
    name: 'Full Swarm (5 Agents)',
    description: 'Orchestrator coordinates 3 parallel worker agents and a designated quality reviewer.',
    members: [
      {
        role: 'orchestrator',
        slot: 'leadModel',
        title: 'Swarm Orchestrator',
        description: 'Deconstructs epics into parallel DAG tasks and assigns worktrees.',
      },
      {
        role: 'worker',
        slot: 'workerModel',
        title: 'Backend Coder',
        description: 'Implements core services, APIs, and business logic.',
      },
      {
        role: 'worker',
        slot: 'workerModel',
        title: 'Frontend Coder',
        description: 'Implements CLI/TUI views, user interactions, and visual layouts.',
      },
      {
        role: 'worker',
        slot: 'workerModel',
        title: 'Test Engineer',
        description: 'Constructs automated unit, property, and integration test suites.',
      },
      {
        role: 'reviewer',
        slot: 'reviewerModel',
        title: 'Gatekeeper Reviewer',
        description: 'Evaluates test coverage, builds, and merges approved patches.',
      },
    ],
    defaultLeadModelSlot: 'leadModel',
    defaultWorkerModelSlot: 'workerModel',
    defaultReviewerModelSlot: 'reviewerModel',
  },
});

// ── Core Oasis Workplace Configuration Schema ──────────────────────────────

export interface MaosOasisConfig {
  version: string;
  oasisRoot: string;
  hardware: {
    gpu: string;
    vramMB: number;
    tier: HardwareTier;
  };
  model: {
    primary: string;
    fallback: string;
    tag: string;
    contextTokens: number;
  };
  ollama: {
    host: string;
    port: number;
    autoStart: boolean;
  };
  dependencies: {
    herdr: {
      available: boolean;
      multiPaneEnabled: boolean;
    };
    opencode: {
      available: boolean;
      harnessEnabled: boolean;
    };
  };
  team: {
    preset: TeamPresetId;
    leadModel: string;
    workerModel: string;
    reviewerModel: string;
  };
}

// ── Doctor Diagnostics Interfaces ──────────────────────────────────────────

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export type DoctorCheckId =
  | 'node_version'
  | 'oasis_config'
  | 'config_and_runtime'
  | 'loopback_opsec'
  | 'ollama_daemon'
  | 'gemma_generation'
  | 'model_benchmark'
  | 'toolchain_integrations'
  | string;

export interface DoctorCheckResult {
  readonly id: DoctorCheckId;
  readonly name: string;
  readonly status: DoctorCheckStatus;
  readonly required?: boolean;
  readonly message: string;
  readonly fixHint?: string;
  readonly durationMs?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface GenerationBenchmark {
  model: string;
  evalCount: number;
  evalDurationSec: number;
  tokensPerSecond: number;
  totalDurationMs: number;
  sampleOutput: string;
  promptEvalCount?: number;
  promptEvalDurationSec?: number;
}

export type DoctorReadiness = 'ready' | 'ready_with_warnings' | 'not_ready';

export interface DoctorReport {
  readonly passed: boolean;
  readonly readiness: DoctorReadiness;
  readonly checks: readonly DoctorCheckResult[];
  readonly timestamp?: string;
  readonly version?: string;
  readonly fixApplied?: boolean;
  readonly benchmark?: GenerationBenchmark;
  readonly exitCode?: 0 | 1;
  readonly summary?: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  };
}

export interface DoctorOptions {
  readonly fix?: boolean;
  readonly cwd?: string;
  readonly silent?: boolean;
  readonly fetch?: typeof globalThis.fetch;
  readonly benchmarkTimeoutMs?: number;
  readonly json?: boolean;
  readonly timeoutMs?: number;
}

// ── Init Wizard Options ────────────────────────────────────────────────────

export interface InitOptions {
  readonly nonInteractive?: boolean;
  readonly yes?: boolean;
  readonly model?: string;
  readonly preset?: TeamPresetId;
  readonly cwd?: string;
  readonly skipPull?: boolean;
  readonly force?: boolean;
}
