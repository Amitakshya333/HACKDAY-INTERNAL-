/**
 * MAOS Oasis — Interactive Initialization Wizard & Sovereign Configurator
 *
 * Implements the 6-step onboarding flow:
 *   Step 1: Directory trust gate
 *   Step 2: Ollama check & daemon startup if stopped
 *   Step 3: Hardware sizing & Gemma model selection
 *   Step 4: Model pulling & verification probe
 *   Step 5: Dependency detection & installation guidance (Herdr / OpenCode)
 *   Step 6: Team preset selection & writing ./maos-oasis.config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';

import {
  MaosOasisConfig,
  HardwareTier,
  HARDWARE_TIER_THRESHOLDS,
  GEMMA_MODEL_CATALOG,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_FALLBACK_MODEL,
  resolveRecommendedGemmaModel,
  TeamPresetId,
  TEAM_PRESETS,
  InitOptions,
} from './types';
import { getOasisConfigPath, loadOasisConfig, saveOasisConfig, ensureOasisRuntimeDirs } from './config';
import { renderPanel, getBrandBadge } from '../utils/ui';

export interface ProbedHardware {
  gpu: string;
  vramMB: number;
  driverVersion?: string;
  tier: HardwareTier;
  isNvidia: boolean;
  isAmd: boolean;
  isCpuOnly: boolean;
  totalRamMB: number;
  cpuCores: number;
}

/**
 * Step 3 Hardware Prober: Queries discrete GPU capabilities via nvidia-smi or ROCm,
 * falling back to total system memory.
 */
export function detectHardware(): ProbedHardware {
  const totalRamMB = Math.round(os.totalmem() / (1024 * 1024));
  const cpuCores = os.cpus()?.length || 1;

  // 1. Check NVIDIA GPU (Windows & Linux)
  try {
    const raw = child_process
      .execSync('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      })
      .trim();

    if (raw) {
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const firstGpu = lines[0].split(',').map((s) => s.trim());
      const gpuName = firstGpu[0] || 'NVIDIA GPU';
      const vramMB = parseInt(firstGpu[1], 10) || 0;
      const driverVersion = firstGpu[2] || undefined;

      let tier: HardwareTier = 'low';
      if (vramMB >= HARDWARE_TIER_THRESHOLDS.HIGH_MAX_VRAM_MB) {
        tier = 'ultra';
      } else if (vramMB >= HARDWARE_TIER_THRESHOLDS.MID_MAX_VRAM_MB) {
        tier = 'high'; // 6GB - 12GB (e.g. RTX 4060 8GB = 8188 MB)
      } else if (vramMB >= HARDWARE_TIER_THRESHOLDS.LOW_MAX_VRAM_MB) {
        tier = 'mid'; // 4GB - 6GB
      } else {
        tier = 'low'; // < 4GB
      }

      return {
        gpu: gpuName,
        vramMB,
        driverVersion,
        tier,
        isNvidia: true,
        isAmd: false,
        isCpuOnly: false,
        totalRamMB,
        cpuCores,
      };
    }
  } catch {
    // nvidia-smi unavailable
  }

  // 2. Check Linux AMD GPU (rocm-smi)
  if (process.platform === 'linux') {
    try {
      const raw = child_process
        .execSync('rocm-smi --showmeminfo vram', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 3000,
        })
        .trim();
      if (raw) {
        return {
          gpu: 'AMD ROCm GPU',
          vramMB: 4096,
          tier: 'mid',
          isNvidia: false,
          isAmd: true,
          isCpuOnly: false,
          totalRamMB,
          cpuCores,
        };
      }
    } catch {
      // rocm-smi unavailable
    }
  }

  // 3. Fallback: CPU Only
  return {
    gpu: 'CPU Only (Integrated Graphics / No discrete GPU)',
    vramMB: 0,
    tier: 'low',
    isNvidia: false,
    isAmd: false,
    isCpuOnly: true,
    totalRamMB,
    cpuCores,
  };
}

/**
 * Resolves Ollama binary executable path across PATH and OS locations.
 */
export function findOllamaBinary(): string | null {
  // Check PATH first
  try {
    const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
    const out = child_process.execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const firstLine = out.split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}

  // Check standard Windows install path
  if (process.platform === 'win32') {
    const winPath = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
    if (fs.existsSync(winPath)) return winPath;
    const progFiles = 'C:\\Program Files\\Ollama\\ollama.exe';
    if (fs.existsSync(progFiles)) return progFiles;
  }

  // Check standard Linux install paths
  if (process.platform === 'linux') {
    for (const p of ['/usr/local/bin/ollama', '/usr/bin/ollama', '/bin/ollama']) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

/**
 * Checks if Ollama daemon is actively responding on loopback port.
 */
export async function isOllamaReachable(host = '127.0.0.1', port = 11434, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Launches Ollama daemon in background and polls until responsive.
 */
export async function startOllamaDaemon(binaryPath: string, host = '127.0.0.1', port = 11434): Promise<boolean> {
  const child = child_process.spawn(binaryPath, ['serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const start = Date.now();
  while (Date.now() - start < 10000) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isOllamaReachable(host, port, 1000)) {
      return true;
    }
  }
  return false;
}

/**
 * Retrieves the list of currently pulled Ollama model tags.
 */
export async function getLocalOllamaModels(host = '127.0.0.1', port = 11434): Promise<string[]> {
  try {
    const res = await fetch(`http://${host}:${port}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * Runs a local generation probe with prompt 'Reply with exactly: OASIS_OK'.
 */
export async function probeGemmaGeneration(
  model: string,
  host = '127.0.0.1',
  port = 11434,
  timeoutMs = 30000,
): Promise<{ success: boolean; tokensPerSecond: number; durationMs: number; output: string; error?: string }> {
  const startTime = Date.now();
  try {
    const res = await fetch(`http://${host}:${port}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: 'Reply with exactly: OASIS_OK',
        stream: false,
        options: {
          num_predict: 16,
          temperature: 0,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        success: false,
        tokensPerSecond: 0,
        durationMs: Date.now() - startTime,
        output: '',
        error: `HTTP ${res.status}: ${errText}`,
      };
    }

    const data = (await res.json()) as {
      response?: string;
      eval_count?: number;
      eval_duration?: number;
    };

    const durationMs = Date.now() - startTime;
    const evalCount = data.eval_count || 1;
    const evalDurationSec = (data.eval_duration || 1) / 1e9;
    const tokensPerSecond = evalDurationSec > 0 ? Math.round((evalCount / evalDurationSec) * 10) / 10 : 0;
    const output = (data.response || '').trim();

    return {
      success: true,
      tokensPerSecond,
      durationMs,
      output,
    };
  } catch (err: any) {
    return {
      success: false,
      tokensPerSecond: 0,
      durationMs: Date.now() - startTime,
      output: '',
      error: err.message,
    };
  }
}

/**
 * Checks Herdr terminal multiplexer availability.
 */
export function checkHerdr(): { available: boolean; version?: string; binaryPath?: string } {
  try {
    const out = child_process
      .execSync('herdr --version', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      })
      .trim();
    return { available: true, version: out };
  } catch {}

  if (process.platform === 'win32') {
    const defaultWin = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Herdr', 'bin', 'herdr.exe');
    if (fs.existsSync(defaultWin)) {
      try {
        const out = child_process
          .execSync(`"${defaultWin}" --version`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 3000,
          })
          .trim();
        return { available: true, version: out, binaryPath: defaultWin };
      } catch {}
    }
  }

  return { available: false };
}

/**
 * Checks OpenCode tool harness availability.
 */
export function checkOpenCode(): { available: boolean; version?: string } {
  try {
    const out = child_process
      .execSync('opencode --version', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      })
      .trim();
    return { available: true, version: out };
  } catch {
    return { available: false };
  }
}

/**
 * Main Interactive Initialization Flow
 */
export async function runOasisInit(options: InitOptions = {}): Promise<MaosOasisConfig> {
  const cwd = path.resolve(options.cwd || process.cwd());
  const isAutomated = Boolean(options.nonInteractive || options.yes);

  // Print Welcome Panel
  console.log('');
  const bannerLines = [
    `${getBrandBadge('OASIS')} ${chalk.bold.hex('#F1F5F9')('MAOS Oasis — Sovereign Multi-Agent Coding Swarm')}`,
    `${chalk.gray('Gemma-First · 100% Local Loopback · Zero Cloud Transmission')}`,
  ];
  console.log(renderPanel(bannerLines, chalk.hex('#10B981')));
  console.log('');

  // ── Step 1: Directory Trust Gate ───────────────────────────────────────────
  console.log(chalk.bold('Step 1: Directory Trust Gate'));
  console.log(chalk.gray(`  Working directory: ${cwd}`));
  console.log(chalk.gray('  MAOS Oasis will initialize configuration here and may:'));
  console.log(chalk.gray('    • Create maos-oasis.config.json and .maos-oasis/ runtime state'));
  console.log(chalk.gray('    • Initialize a local Git repository / worktrees for parallel agents'));
  console.log(chalk.gray('    • Read and edit files inside this directory'));
  console.log('');

  const configPath = getOasisConfigPath(cwd);
  if (fs.existsSync(configPath) && !options.force && !options.yes) {
    if (options.nonInteractive) {
      throw new Error(`Directory is already initialized with MAOS Oasis: ${configPath}. Use --force to overwrite.`);
    }
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'This directory is already initialized with MAOS Oasis. What would you like to do?',
        choices: [
          { name: 'Overwrite and reconfigure', value: 'overwrite' },
          { name: 'Keep existing configuration and exit', value: 'keep' },
        ],
        default: 'overwrite',
      },
    ]);
    if (action === 'keep') {
      const existing = loadOasisConfig(cwd);
      if (existing) return existing;
    }
  }

  if (!isAutomated) {
    const { trust } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'trust',
        message: 'Do you trust this directory to initialize MAOS Oasis?',
        default: true,
      },
    ]);
    if (!trust) {
      console.log(chalk.yellow('\nAborted by user. No files were created or modified.\n'));
      process.exit(0);
    }
  }
  console.log(chalk.green('  ✔ Directory trust confirmed.\n'));

  // ── Step 2: Ollama Check & Daemon Startup ──────────────────────────────────
  console.log(chalk.bold('Step 2: Ollama Daemon Liveness & Connectivity'));
  let ollamaBin = findOllamaBinary();
  let reachable = await isOllamaReachable();

  if (!ollamaBin && !reachable) {
    console.log(chalk.yellow('  ⚠️ Ollama binary not found in PATH or standard directories.'));
    console.log(chalk.gray('  Ollama is required to run local Gemma models sovereignly.\n'));

    if (process.platform === 'win32') {
      console.log(chalk.cyan('  Download installer from: https://ollama.com/download\n'));
      if (!isAutomated) {
        const { openBrowser } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'openBrowser',
            message: 'Open https://ollama.com/download in your default browser now?',
            default: true,
          },
        ]);
        if (openBrowser) {
          try {
            child_process.exec('cmd /c start https://ollama.com/download');
          } catch {}
        }
        await inquirer.prompt([
          {
            type: 'input',
            name: 'continue',
            message: 'Press Enter after finishing Ollama installation to re-check...',
          },
        ]);
        ollamaBin = findOllamaBinary();
        reachable = await isOllamaReachable();
      }
    } else {
      console.log(chalk.cyan('  Install command: curl -fsSL https://ollama.com/install.sh | sh\n'));
    }

    if (!ollamaBin && !reachable && options.nonInteractive) {
      throw new Error('Ollama is not installed. Please install Ollama from https://ollama.com/download.');
    }
  }

  if (!reachable) {
    console.log(chalk.yellow('  ⚠️ Ollama daemon is stopped (port 11434 unreachable).'));
    const startIt =
      isAutomated ||
      (
        await inquirer.prompt([
          {
            type: 'confirm',
            name: 'startIt',
            message: 'Start "ollama serve" in the background now?',
            default: true,
          },
        ])
      ).startIt;

    if (startIt && ollamaBin) {
      const spinner = ora('Starting Ollama daemon on 127.0.0.1:11434...').start();
      const started = await startOllamaDaemon(ollamaBin);
      if (started) {
        spinner.succeed('Ollama daemon started successfully on 127.0.0.1:11434');
        reachable = true;
      } else {
        spinner.fail('Failed to start Ollama daemon automatically within 10s.');
        console.log(chalk.yellow('  Please run "ollama serve" in another terminal.\n'));
      }
    }
  } else {
    console.log(chalk.green('  ✔ Ollama daemon is live and listening on http://127.0.0.1:11434\n'));
  }

  // ── Step 3: Hardware Sizing & Gemma Model Selection ────────────────────────
  console.log(chalk.bold('Step 3: Hardware Sizing & Gemma Model Selection'));
  const hw = detectHardware();
  console.log(`  ✔ Detected Hardware: ${chalk.bold.cyan(hw.gpu)}`);
  if (hw.vramMB > 0) {
    console.log(`  ✔ VRAM Capacity   : ${chalk.bold.cyan(hw.vramMB + ' MB')} (~${Math.round(hw.vramMB / 1024)} GB)`);
  }
  console.log(`  ✔ Hardware Tier   : ${chalk.bold.green(hw.tier.toUpperCase())}`);
  if (hw.driverVersion) {
    console.log(`  ✔ Driver Version  : ${chalk.gray(hw.driverVersion)}`);
  }
  console.log('');

  const recommendation = resolveRecommendedGemmaModel(hw.tier);
  let selectedModel = options.model || recommendation.primary;

  if (!options.model && !isAutomated) {
    const localModels = await getLocalOllamaModels();
    const choices = Object.values(GEMMA_MODEL_CATALOG).map((spec) => {
      const isDownloaded = localModels.includes(spec.tag);
      const isRecommended = spec.tag === recommendation.primary;
      const tagLabel = isRecommended ? chalk.bold.green(spec.tag) : chalk.white(spec.tag);
      const dlBadge = isDownloaded ? chalk.green(' [Installed]') : chalk.gray(' [Needs Pull]');
      const recBadge = isRecommended ? chalk.hex('#F59E0B')(' ★ RECOMMENDED') : '';
      return {
        name: `${tagLabel.padEnd(25)} ${spec.vramFootprintText.padEnd(22)} ${dlBadge}${recBadge}`,
        value: spec.tag,
      };
    });

    const { modelChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'modelChoice',
        message: `Select primary Gemma model for reasoning & coding:`,
        choices,
        default: recommendation.primary,
      },
    ]);
    selectedModel = modelChoice;
  }
  console.log(`  ✔ Selected Model: ${chalk.bold.cyan(selectedModel)}\n`);

  // ── Step 4: Model Pulling & Local Generation Verification Probe ────────────
  console.log(chalk.bold('Step 4: Model Presence & Local Generation Check'));
  const localModels = await getLocalOllamaModels();
  const alreadyDownloaded = localModels.includes(selectedModel);

  if (!alreadyDownloaded) {
    console.log(chalk.yellow(`  ⚠️ Model "${selectedModel}" is not currently downloaded in Ollama.`));
    let doPull = true;
    if (!isAutomated && !options.skipPull) {
      const { confirmPull } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmPull',
          message: `Pull "${selectedModel}" now via Ollama?`,
          default: true,
        },
      ]);
      doPull = confirmPull;
    } else if (options.skipPull) {
      doPull = false;
    }

    if (doPull) {
      const bin = ollamaBin || 'ollama';
      console.log(chalk.cyan(`\n  Running: ${bin} pull ${selectedModel}`));
      const pullResult = child_process.spawnSync(bin, ['pull', selectedModel], {
        stdio: 'inherit',
        encoding: 'utf-8',
      });
      if (pullResult.status === 0) {
        console.log(chalk.green(`  ✔ Model "${selectedModel}" pulled successfully.\n`));
      } else {
        console.log(chalk.red(`  ✖ Model pull failed with code ${pullResult.status}.\n`));
      }
    }
  } else {
    console.log(`  ✔ Model "${selectedModel}" is already present in local Ollama storage.`);
  }

  // Generation verification probe
  const probeSpinner = ora(`Testing local inference with ${selectedModel} (prompt: "OASIS_OK")...`).start();
  const probe = await probeGemmaGeneration(selectedModel);
  if (probe.success) {
    probeSpinner.succeed(
      `Generation probe passed: Gemma responded in ${probe.durationMs}ms (~${probe.tokensPerSecond} tok/s)`,
    );
  } else {
    probeSpinner.warn(`Generation probe warning: ${probe.error || 'Model did not complete prompt within timeout.'}`);
    if (!isAutomated) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'How would you like to handle the generation check warning?',
          choices: [
            { name: `Proceed anyway with ${selectedModel}`, value: 'proceed' },
            { name: `Downgrade to lightweight ${DEFAULT_FALLBACK_MODEL}`, value: 'downgrade' },
          ],
          default: 'proceed',
        },
      ]);
      if (action === 'downgrade') {
        selectedModel = DEFAULT_FALLBACK_MODEL;
        console.log(`  ✔ Switched to fallback model: ${chalk.bold.cyan(selectedModel)}`);
      }
    }
  }
  console.log('');

  // ── Step 5: Dependency Detection & Installation Guidance ───────────────────
  console.log(chalk.bold('Step 5: Companion Toolchain Detection (Herdr & OpenCode)'));

  // Herdr
  const herdrInfo = checkHerdr();
  let herdrEnabled = herdrInfo.available;
  if (herdrInfo.available) {
    console.log(`  ✔ Herdr detected: ${chalk.green(herdrInfo.version || 'installed')} — Multi-pane tiling enabled`);
  } else {
    console.log(
      chalk.yellow('  ⚠️ Herdr is not installed — Multi-pane tiling will be disabled (single-pane fallback)'),
    );
    console.log(chalk.gray('     Herdr provides side-by-side terminal panes for parallel swarm agents.'));
    if (!isAutomated) {
      const { herdrChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'herdrChoice',
          message: 'Herdr setup option:',
          choices: [
            { name: 'Install Herdr now (recommended)', value: 'install' },
            { name: 'Skip and continue in single-pane mode', value: 'skip' },
          ],
          default: 'skip',
        },
      ]);

      if (herdrChoice === 'install') {
        console.log(chalk.cyan('  Running Herdr installer...'));
        if (process.platform === 'win32') {
          child_process.spawnSync('powershell', ['-Command', 'irm https://herdr.dev/install.ps1 | iex'], {
            stdio: 'inherit',
          });
        } else {
          child_process.spawnSync('bash', ['-c', 'curl -fsSL https://herdr.dev/install.sh | sh'], {
            stdio: 'inherit',
          });
        }
        const recheck = checkHerdr();
        if (recheck.available) {
          herdrEnabled = true;
          console.log(chalk.green('  ✔ Herdr successfully installed!'));
        }
      }
    }
  }

  // OpenCode
  const opencodeInfo = checkOpenCode();
  let opencodeEnabled = opencodeInfo.available;
  if (opencodeInfo.available) {
    console.log(`  ✔ OpenCode detected: ${chalk.green(opencodeInfo.version || 'installed')} — Tool harness enabled`);
  } else {
    console.log(
      chalk.yellow('  ⚠️ OpenCode is not installed — AST/diff harness disabled (direct loopback API fallback)'),
    );
    console.log(chalk.gray('     OpenCode provides AST-aware file navigation, diff generation, and tool loops.'));
    if (!isAutomated) {
      const { opencodeChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'opencodeChoice',
          message: 'OpenCode setup option:',
          choices: [
            { name: 'Install OpenCode now (npm install -g @opencode/cli)', value: 'install' },
            { name: 'Skip and continue with direct loopback API calls', value: 'skip' },
          ],
          default: 'skip',
        },
      ]);

      if (opencodeChoice === 'install') {
        console.log(chalk.cyan('  Running: npm install -g @opencode/cli'));
        const npmRes = child_process.spawnSync('npm', ['install', '-g', '@opencode/cli'], {
          stdio: 'inherit',
          shell: true,
        });
        if (npmRes.status === 0 && checkOpenCode().available) {
          opencodeEnabled = true;
          console.log(chalk.green('  ✔ OpenCode successfully installed!'));
        }
      }
    }
  }
  console.log('');

  // ── Step 6: Team Preset Selection & Config Persistence ─────────────────────
  console.log(chalk.bold('Step 6: Team Preset Selection & Configuration'));
  let presetChoice: TeamPresetId = options.preset || 'team';

  if (!options.preset && !isAutomated) {
    const { preset } = await inquirer.prompt([
      {
        type: 'list',
        name: 'preset',
        message: 'Select swarm team configuration:',
        choices: [
          {
            name: `${chalk.bold('Solo')}    — 1 Worker Agent (low VRAM / sequential execution)`,
            value: 'solo',
          },
          {
            name: `${chalk.bold('Duo')}     — 2 Agents (Lead Architect + Reviewer / QA)`,
            value: 'duo',
          },
          {
            name: `${chalk.bold('Team')}    — Full Swarm (Orchestrator + 3 Parallel Workers + Reviewer)`,
            value: 'team',
          },
        ],
        default: 'team',
      },
    ]);
    presetChoice = preset;
  }

  const presetConfig = TEAM_PRESETS[presetChoice];
  const fallbackModel = DEFAULT_FALLBACK_MODEL;

  // Build MaosOasisConfig conforming to types.ts
  const oasisConfig: MaosOasisConfig = {
    version: '1.0.0',
    oasisRoot: cwd,
    hardware: {
      gpu: hw.gpu,
      vramMB: hw.vramMB,
      tier: hw.tier,
    },
    model: {
      primary: selectedModel,
      fallback: fallbackModel,
      tag: selectedModel,
      contextTokens: selectedModel.includes('2b') ? 4096 : 8192,
    },
    ollama: {
      host: '127.0.0.1',
      port: 11434,
      autoStart: true,
    },
    dependencies: {
      herdr: {
        available: herdrEnabled,
        multiPaneEnabled: herdrEnabled,
      },
      opencode: {
        available: opencodeEnabled,
        harnessEnabled: opencodeEnabled,
      },
    },
    team: {
      preset: presetChoice,
      leadModel: selectedModel,
      workerModel: selectedModel,
      reviewerModel: fallbackModel || selectedModel,
    },
  };

  // Write ./maos-oasis.config.json & initialize ./.maos-oasis/
  saveOasisConfig(oasisConfig, cwd);
  ensureOasisRuntimeDirs(cwd);

  // Initialize git repository if .git missing (required for worktree branch isolation)
  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      child_process.execSync('git init', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(chalk.gray('  Initialized local git repository for worktree isolation.'));
    } catch {
      console.log(chalk.yellow('  ⚠️ Could not auto-init git repo.'));
    }
  }

  // Display Completion Banner
  console.log('');
  const finishLines = [
    `${chalk.bold.green('✔ MAOS Oasis initialized successfully!')}`,
    `${chalk.gray('Configuration saved to: ')}${chalk.white('./maos-oasis.config.json')}`,
    `${chalk.gray('Runtime state created at: ')}${chalk.white('./.maos-oasis/')}`,
    '',
    `${chalk.gray('Active Model: ')}${chalk.cyan(selectedModel)}  ${chalk.gray('· Hardware Tier: ')}${chalk.green(hw.tier.toUpperCase())}`,
    `${chalk.gray('Team Preset : ')}${chalk.white(presetConfig.name)}`,
    `${chalk.gray('Multi-Pane  : ')}${herdrEnabled ? chalk.green('Enabled (Herdr)') : chalk.yellow('Single-Pane Fallback')}`,
    `${chalk.gray('Tool Harness: ')}${opencodeEnabled ? chalk.green('Enabled (OpenCode)') : chalk.yellow('Direct Loopback API')}`,
    '',
    `${chalk.bold.white('Next: ')}Run ${chalk.bold.cyan('maos-oasis')} or ${chalk.bold.cyan('maos-oasis run')} to launch your sovereign workplace.`,
  ];
  console.log(renderPanel(finishLines, chalk.hex('#10B981')));
  console.log('');

  return oasisConfig;
}
