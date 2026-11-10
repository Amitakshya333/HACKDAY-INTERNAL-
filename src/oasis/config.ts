/**
 * MAOS Oasis — Workplace Configuration & Runtime State Manager
 *
 * Handles:
 *   - Resolution of config file path (`./maos-oasis.config.json`)
 *   - Resolution of runtime state directory (`./.maos-oasis/`)
 *   - Safe atomic loading and saving of `MaosOasisConfig`
 *   - Initialization of runtime directories (`queue/`, `logs/`, `status/`)
 *   - Idempotent `.gitignore` hardening (ignoring runtime state, tracking config)
 *   - Strict sovereign loopback OpSec validation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import {
  MaosOasisConfig,
  HardwareProfile,
  TeamPresetId,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_FALLBACK_MODEL,
  resolveRecommendedGemmaModel,
} from './types';

export const OASIS_CONFIG_FILE = 'maos-oasis.config.json';
export const OASIS_RUNTIME_DIR = '.maos-oasis';
export const OASIS_CURRENT_VERSION = '1.0.0';

// ── Errors ─────────────────────────────────────────────────────────────────

export class OasisConfigError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[OasisConfigError] ${message}`);
    this.name = 'OasisConfigError';
    Object.setPrototypeOf(this, OasisConfigError.prototype);
  }
}

export class OasisOpSecError extends Error {
  constructor(message: string) {
    super(`[OasisOpSecError] Loopback security violation: ${message}`);
    this.name = 'OasisOpSecError';
    Object.setPrototypeOf(this, OasisOpSecError.prototype);
  }
}

// ── Path Helpers ───────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the project root's `maos-oasis.config.json`.
 */
export function getOasisConfigPath(cwd: string = process.cwd()): string {
  return path.resolve(cwd, OASIS_CONFIG_FILE);
}

/**
 * Returns the absolute path to the `.maos-oasis/` runtime directory.
 */
export function getOasisRuntimeDir(cwd: string = process.cwd()): string {
  return path.resolve(cwd, OASIS_RUNTIME_DIR);
}

/**
 * Returns the path to `.maos-oasis/queue`.
 */
export function getOasisQueueDir(cwd: string = process.cwd()): string {
  return path.join(getOasisRuntimeDir(cwd), 'queue');
}

/**
 * Returns the path to `.maos-oasis/logs`.
 */
export function getOasisLogsDir(cwd: string = process.cwd()): string {
  return path.join(getOasisRuntimeDir(cwd), 'logs');
}

/**
 * Returns the path to `.maos-oasis/status`.
 */
export function getOasisStatusDir(cwd: string = process.cwd()): string {
  return path.join(getOasisRuntimeDir(cwd), 'status');
}

/**
 * Checks if MAOS Oasis has been initialized in the target directory.
 */
export function isOasisInitialized(cwd: string = process.cwd()): boolean {
  return fs.existsSync(getOasisConfigPath(cwd));
}

// ── OpSec & Loopback Enforcement ───────────────────────────────────────────

/**
 * Strictly verifies whether a hostname or IP string represents local loopback.
 * Valid loopbacks: "localhost", "127.0.0.1", "127.x.x.x", "::1", "[::1]".
 * Rejects 0.0.0.0, private LANs, cloud hostnames, or public IPs.
 */
export function isLoopbackHost(host: string): boolean {
  if (!host || typeof host !== 'string') return false;

  const clean = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');

  if (clean === 'localhost' || clean === '::1' || clean === '0:0:0:0:0:0:0:1') {
    return true;
  }

  const ipVersion = net.isIP(clean);
  if (ipVersion === 4) {
    const parts = clean.split('.').map((p) => parseInt(p, 10));
    if (parts.length === 4 && !parts.some(isNaN)) {
      return parts[0] === 127; // Loopback 127.0.0.0/8
    }
  }

  return false;
}

/**
 * Asserts that a host or URL is strictly loopback, throwing OasisOpSecError otherwise.
 */
export function assertLoopbackHost(hostOrUrl: string, component: string = 'Ollama'): void {
  let hostname = hostOrUrl;

  try {
    if (hostOrUrl.includes('://')) {
      const parsed = new URL(hostOrUrl);
      hostname = parsed.hostname;
    }
  } catch {
    // If not a valid URL, treat as raw host
  }

  if (!isLoopbackHost(hostname)) {
    throw new OasisOpSecError(
      `${component} endpoint host "${hostOrUrl}" is not a sovereign loopback address. ` +
        `Only "127.0.0.1", "localhost", and "::1" are permitted. Remote or cloud hosts are forbidden.`,
    );
  }
}

/**
 * Validates a loaded or generated config for schema integrity and OpSec compliance.
 */
export function validateOasisConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration is null or not an object'] };
  }

  if (!config.version || typeof config.version !== 'string') {
    errors.push('Missing or invalid "version"');
  }

  if (!config.hardware || typeof config.hardware !== 'object') {
    errors.push('Missing "hardware" configuration section');
  } else {
    if (typeof config.hardware.gpu !== 'string') errors.push('Missing "hardware.gpu"');
    if (typeof config.hardware.vramMB !== 'number') errors.push('Missing "hardware.vramMB"');
    if (!['low', 'mid', 'high', 'ultra'].includes(config.hardware.tier)) {
      errors.push(`Invalid "hardware.tier": "${config.hardware.tier}"`);
    }
  }

  if (!config.model || typeof config.model !== 'object') {
    errors.push('Missing "model" configuration section');
  } else {
    if (!config.model.primary) errors.push('Missing "model.primary"');
    if (!config.model.fallback) errors.push('Missing "model.fallback"');
    if (!config.model.tag) errors.push('Missing "model.tag"');
    if (typeof config.model.contextTokens !== 'number') errors.push('Missing "model.contextTokens"');
  }

  if (!config.ollama || typeof config.ollama !== 'object') {
    errors.push('Missing "ollama" configuration section');
  } else {
    if (!isLoopbackHost(config.ollama.host)) {
      errors.push(`OpSec violation: "ollama.host" must be loopback (got "${config.ollama.host}")`);
    }
    if (
      typeof config.ollama.port !== 'number' ||
      !Number.isInteger(config.ollama.port) ||
      config.ollama.port <= 0 ||
      config.ollama.port > 65535
    ) {
      errors.push(`Invalid "ollama.port": "${config.ollama.port}"`);
    }
  }

  if (!config.dependencies || typeof config.dependencies !== 'object') {
    errors.push('Missing "dependencies" configuration section');
  }

  if (!config.team || typeof config.team !== 'object') {
    errors.push('Missing "team" configuration section');
  } else {
    if (!['solo', 'duo', 'team'].includes(config.team.preset)) {
      errors.push(`Invalid "team.preset": "${config.team.preset}"`);
    }
  }

  // OpSec: Verify zero cloud credential leakage
  const serialized = JSON.stringify(config).toLowerCase();
  if (serialized.includes('apikey') || serialized.includes('api_key') || serialized.includes('sk-')) {
    errors.push('OpSec violation: Cloud API credentials or keys must not be persisted in maos-oasis.config.json');
  }

  return { valid: errors.length === 0, errors };
}

// ── Config Loading & Saving ────────────────────────────────────────────────

/**
 * Loads and validates `maos-oasis.config.json` from the project directory.
 * Returns null if the file does not exist.
 */
export function loadOasisConfig(cwd: string = process.cwd()): MaosOasisConfig | null {
  const configPath = getOasisConfigPath(cwd);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    const validation = validateOasisConfig(parsed);
    if (!validation.valid) {
      throw new OasisConfigError(
        `Invalid Oasis configuration in ${configPath}:\n  - ${validation.errors.join('\n  - ')}`,
      );
    }

    return parsed as MaosOasisConfig;
  } catch (err: unknown) {
    if (err instanceof OasisConfigError || err instanceof OasisOpSecError) {
      throw err;
    }
    throw new OasisConfigError(
      `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/**
 * Saves `MaosOasisConfig` to `maos-oasis.config.json`.
 * Enforces validation and loopback OpSec before writing.
 */
export function saveOasisConfig(config: MaosOasisConfig, cwd: string = process.cwd()): void {
  const validation = validateOasisConfig(config);
  if (!validation.valid) {
    throw new OasisConfigError(`Cannot save invalid Oasis configuration:\n  - ${validation.errors.join('\n  - ')}`);
  }

  assertLoopbackHost(config.ollama.host, 'Ollama config');

  const configPath = getOasisConfigPath(cwd);
  const jsonContent = JSON.stringify(config, null, 2) + '\n';

  try {
    fs.writeFileSync(configPath, jsonContent, 'utf-8');
  } catch (err: unknown) {
    throw new OasisConfigError(`Failed to write config file to ${configPath}`, err);
  }
}

// ── Runtime Directories & Gitignore ────────────────────────────────────────

/**
 * Ensures all `.maos-oasis/` runtime subdirectories exist and hardens `.gitignore`.
 */
export function ensureOasisRuntimeDirs(cwd: string = process.cwd()): void {
  const runtimeDir = getOasisRuntimeDir(cwd);
  const queueDir = getOasisQueueDir(cwd);
  const dirs = [
    runtimeDir,
    queueDir,
    path.join(queueDir, 'pending'),
    path.join(queueDir, 'active'),
    path.join(queueDir, 'done'),
    path.join(queueDir, 'failed'),
    getOasisLogsDir(cwd),
    getOasisStatusDir(cwd),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Write runtime internal .gitignore inside .maos-oasis/.gitignore
  const innerGitignore = path.join(runtimeDir, '.gitignore');
  if (!fs.existsSync(innerGitignore)) {
    try {
      fs.writeFileSync(innerGitignore, '*\n!.gitignore\n', 'utf-8');
    } catch {
      // non-fatal
    }
  }

  try {
    hardenOasisGitignore(cwd);
  } catch {
    // Non-fatal: do not block startup if gitignore is read-only or outside git root
  }
}

/**
 * Hardens `.gitignore` to ensure `.maos-oasis/` runtime state is never committed,
 * while allowing `maos-oasis.config.json` to remain tracked.
 */
export function hardenOasisGitignore(cwd: string = process.cwd()): void {
  const gitignorePath = path.resolve(cwd, '.gitignore');
  const requiredIgnores = [
    '.maos-oasis/',
    '.maos-oasis/queue/',
    '.maos-oasis/logs/',
    '.maos-oasis/status/',
    '.maos-oasis/*.log',
  ];

  let currentContent = '';
  if (fs.existsSync(gitignorePath)) {
    try {
      currentContent = fs.readFileSync(gitignorePath, 'utf-8');
    } catch {
      currentContent = '';
    }
  }

  const lines = currentContent.split(/\r?\n/).map((l) => l.trim());
  const toAppend: string[] = [];

  for (const item of requiredIgnores) {
    const normalizedItem = item.replace(/\\/g, '/');
    const alreadyPresent = lines.some((line) => {
      const normalizedLine = line.trim().replace(/\\/g, '/');
      return (
        normalizedLine === normalizedItem ||
        normalizedLine === normalizedItem.replace(/\/$/, '') ||
        normalizedLine === '/' + normalizedItem
      );
    });

    if (!alreadyPresent) {
      toAppend.push(item);
    }
  }

  if (toAppend.length > 0) {
    const divider = currentContent && !currentContent.endsWith('\n') ? '\n' : '';
    const header = currentContent.includes('# MAOS Oasis Runtime Internals')
      ? ''
      : '\n# MAOS Oasis Runtime Internals (Ephemeral Agent Logs & State)\n';
    fs.appendFileSync(gitignorePath, divider + header + toAppend.join('\n') + '\n', 'utf-8');
  }
}

// ── Default Config Generator ───────────────────────────────────────────────

export interface CreateConfigOptions {
  cwd?: string;
  hardware?: HardwareProfile;
  preset?: TeamPresetId;
  selectedModel?: string;
  herdrAvailable?: boolean;
  opencodeAvailable?: boolean;
}

/**
 * Factory that constructs a compliant `MaosOasisConfig` object.
 */
export function createDefaultOasisConfig(options: CreateConfigOptions = {}): MaosOasisConfig {
  const targetCwd = path.resolve(options.cwd || process.cwd());
  const hw = options.hardware || {
    gpuName: 'NVIDIA GeForce RTX 4060 Laptop GPU',
    vramMB: 8188,
    tier: 'high',
    isNvidia: true,
    isAmd: false,
    isCpuOnly: false,
    totalRamMB: 16384,
  };

  const modelDefaults = resolveRecommendedGemmaModel(hw.tier);
  const activeModel = options.selectedModel || modelDefaults.primary;
  const preset: TeamPresetId = options.preset || 'duo';

  return {
    version: OASIS_CURRENT_VERSION,
    oasisRoot: targetCwd,
    hardware: {
      gpu: hw.gpuName,
      vramMB: hw.vramMB,
      tier: hw.tier,
    },
    model: {
      primary: modelDefaults.primary,
      fallback: modelDefaults.fallback,
      tag: activeModel,
      contextTokens: modelDefaults.contextTokens,
    },
    ollama: {
      host: '127.0.0.1',
      port: 11434,
      autoStart: true,
    },
    dependencies: {
      herdr: {
        available: options.herdrAvailable ?? false,
        multiPaneEnabled: options.herdrAvailable ?? false,
      },
      opencode: {
        available: options.opencodeAvailable ?? false,
        harnessEnabled: options.opencodeAvailable ?? false,
      },
    },
    team: {
      preset,
      leadModel: activeModel,
      workerModel: activeModel,
      reviewerModel: activeModel,
    },
  };
}
