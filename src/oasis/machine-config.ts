/**
 * MAOS Oasis — Two-Level Configuration Manager (Architecture v4)
 *
 * Implements:
 *   - Machine-wide config (`~/.maos-oasis/config.json`) set up once per machine
 *   - Project-level overrides (`<project-root>/.maos-oasis/project.json`)
 *   - Hierarchical config precedence: project.json > ~/.maos-oasis/config.json > defaults
 *   - Dotted key getter/setter for CLI `maos-oasis config set <key> <value>`
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  MaosOasisConfig,
  HardwareTier,
  TeamPresetId,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_FALLBACK_MODEL,
  resolveRecommendedGemmaModel,
} from './types';
import {
  validateOasisConfig,
  assertLoopbackHost,
  OasisConfigError,
  OASIS_CURRENT_VERSION,
  createDefaultOasisConfig,
} from './config';
import { atomicWriteFile } from './session-manager';
import { findProjectRoot } from './trust';

export const MACHINE_CONFIG_DIR = '.maos-oasis';
export const MACHINE_CONFIG_FILE = 'config.json';
export const PROJECT_CONFIG_FILE = 'project.json';

/**
 * Returns path to machine config directory: `~/.maos-oasis`
 */
export function getMachineConfigDir(): string {
  const home = process.env.MAOS_HOME || os.homedir();
  return path.join(home, MACHINE_CONFIG_DIR);
}

/**
 * Returns path to machine config file: `~/.maos-oasis/config.json`
 */
export function getMachineConfigPath(): string {
  return path.join(getMachineConfigDir(), MACHINE_CONFIG_FILE);
}

/**
 * Returns path to project-level config file: `<project-root>/.maos-oasis/project.json`
 */
export function getProjectConfigPath(projectRoot: string = process.cwd()): string {
  return path.join(path.resolve(projectRoot), '.maos-oasis', PROJECT_CONFIG_FILE);
}

/**
 * Loads machine configuration from `~/.maos-oasis/config.json`.
 * Returns null if not configured or file does not exist.
 */
export function loadMachineConfig(): MaosOasisConfig | null {
  const cfgPath = getMachineConfigPath();
  if (!fs.existsSync(cfgPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validation = validateOasisConfig(parsed);
    if (!validation.valid) {
      console.warn(`[Oasis] Warning: Machine config at ${cfgPath} has schema issues: ${validation.errors.join(', ')}`);
      return null;
    }
    return parsed as MaosOasisConfig;
  } catch (err: any) {
    console.warn(`[Oasis] Warning: Could not parse machine config at ${cfgPath}: ${err.message}`);
    return null;
  }
}

/**
 * Atomically saves machine configuration to `~/.maos-oasis/config.json`.
 */
export function saveMachineConfig(config: MaosOasisConfig): void {
  const dir = getMachineConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const validation = validateOasisConfig(config);
  if (!validation.valid) {
    throw new OasisConfigError(`Cannot save invalid machine config:\n  - ${validation.errors.join('\n  - ')}`);
  }

  assertLoopbackHost(config.ollama.host, 'Machine config Ollama');

  const cfgPath = getMachineConfigPath();
  atomicWriteFile(cfgPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Loads project-specific overrides from `<project-root>/.maos-oasis/project.json`.
 */
export function loadProjectConfig(projectRoot: string = process.cwd()): Partial<MaosOasisConfig> | null {
  const cfgPath = getProjectConfigPath(projectRoot);
  if (!fs.existsSync(cfgPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    return JSON.parse(raw) as Partial<MaosOasisConfig>;
  } catch {
    return null;
  }
}

/**
 * Atomically saves project overrides to `<project-root>/.maos-oasis/project.json`.
 */
export function saveProjectConfig(projectRoot: string, config: Partial<MaosOasisConfig>): void {
  const dir = path.join(path.resolve(projectRoot), '.maos-oasis');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const cfgPath = getProjectConfigPath(projectRoot);
  atomicWriteFile(cfgPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Resolves effective configuration using precedence:
 *   project.json > ~/.maos-oasis/config.json > local maos-oasis.config.json > built-in defaults
 */
export function resolveEffectiveConfig(cwd: string = process.cwd()): MaosOasisConfig | null {
  const projectRoot = findProjectRoot(cwd);

  // 1. Check local legacy maos-oasis.config.json if it exists in cwd or project root
  let legacyConfig: MaosOasisConfig | null = null;
  const localLegacy = path.resolve(cwd, 'maos-oasis.config.json');
  const projectLegacy = path.resolve(projectRoot, 'maos-oasis.config.json');
  const legacyPath = fs.existsSync(localLegacy) ? localLegacy : fs.existsSync(projectLegacy) ? projectLegacy : null;

  if (legacyPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      if (validateOasisConfig(parsed).valid) {
        legacyConfig = parsed as MaosOasisConfig;
      }
    } catch {}
  }

  const machineConfig = loadMachineConfig();
  const projectConfig = loadProjectConfig(projectRoot);

  if (!machineConfig && !projectConfig && !legacyConfig) {
    return null;
  }

  const base = machineConfig || legacyConfig || createDefaultOasisConfig({ cwd: projectRoot });

  if (!projectConfig) {
    return { ...base, oasisRoot: projectRoot };
  }

  // Deep merge project overrides onto base
  return {
    ...base,
    oasisRoot: projectRoot,
    hardware: { ...base.hardware, ...(projectConfig.hardware || {}) },
    model: { ...base.model, ...(projectConfig.model || {}) },
    ollama: { ...base.ollama, ...(projectConfig.ollama || {}) },
    dependencies: { ...base.dependencies, ...(projectConfig.dependencies || {}) },
    team: { ...base.team, ...(projectConfig.team || {}) },
  };
}

/**
 * Sets a configuration value using dot notation (e.g., 'model.tag', 'ollama.port').
 */
export function setConfigValue(keyPath: string, value: unknown, options?: { project?: boolean; cwd?: string }): void {
  const cwd = options?.cwd || process.cwd();
  const projectRoot = findProjectRoot(cwd);
  const isProject = Boolean(options?.project);

  if (isProject) {
    const existing = loadProjectConfig(projectRoot) || {};
    setNestedProperty(existing, keyPath, coerceConfigValue(value));
    saveProjectConfig(projectRoot, existing);
  } else {
    let existing = loadMachineConfig();
    if (!existing) {
      existing = createDefaultOasisConfig({ cwd: projectRoot });
    }
    setNestedProperty(existing, keyPath, coerceConfigValue(value));
    if (keyPath.startsWith('ollama.host')) {
      assertLoopbackHost(String(value), 'Config set Ollama host');
    }
    saveMachineConfig(existing);
  }
}

/**
 * Gets a configuration value by dot notation.
 */
export function getConfigValue(keyPath: string, options?: { project?: boolean; cwd?: string }): unknown {
  const cwd = options?.cwd || process.cwd();
  const projectRoot = findProjectRoot(cwd);

  const target = options?.project ? loadProjectConfig(projectRoot) : resolveEffectiveConfig(cwd);

  if (!target) return undefined;
  return getNestedProperty(target, keyPath);
}

function coerceConfigValue(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  if (val.toLowerCase() === 'true') return true;
  if (val.toLowerCase() === 'false') return false;
  const num = Number(val);
  if (!isNaN(num) && String(num) === val.trim()) return num;
  return val;
}

function setNestedProperty(obj: Record<string, any>, keyPath: string, value: unknown): void {
  const parts = keyPath.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!curr[p] || typeof curr[p] !== 'object') {
      curr[p] = {};
    }
    curr = curr[p];
  }
  curr[parts[parts.length - 1]] = value;
}

function getNestedProperty(obj: Record<string, any>, keyPath: string): unknown {
  const parts = keyPath.split('.');
  let curr: any = obj;
  for (const p of parts) {
    if (curr === null || curr === undefined || typeof curr !== 'object') {
      return undefined;
    }
    curr = curr[p];
  }
  return curr;
}
