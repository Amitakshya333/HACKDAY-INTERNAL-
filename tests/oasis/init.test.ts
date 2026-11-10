import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import inquirer from 'inquirer';

const actualFs = vi.hoisted(() => {
  const realFs = require('fs');
  return { existsSync: realFs.existsSync.bind(realFs) };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p) => actual.existsSync(p)),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn((cmd, opts) => actual.execSync(cmd, opts)),
    spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' }) as any),
    spawn: vi.fn((...args: any[]) => ({ unref: vi.fn() }) as any),
  };
});

import {
  runOasisInit,
  detectHardware,
  findOllamaBinary,
  isOllamaReachable,
  startOllamaDaemon,
  getLocalOllamaModels,
  probeGemmaGeneration,
  checkHerdr,
  checkOpenCode,
} from '../../src/oasis/init';

import {
  resolveRecommendedGemmaModel,
  GEMMA_MODEL_CATALOG,
  HARDWARE_TIER_THRESHOLDS,
  TEAM_PRESETS,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_FALLBACK_MODEL,
  MaosOasisConfig,
} from '../../src/oasis/types';

import { loadOasisConfig, saveOasisConfig, getOasisConfigPath, getOasisRuntimeDir } from '../../src/oasis/config';

describe('Oasis Init Flow & Onboarding Suite (tests/oasis/init.test.ts)', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-init-unit-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(fs.existsSync).mockImplementation(actualFs.existsSync);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Hardware Sizing & Model Recommendation ─────────────────────────────
  describe('Hardware Sizing & Gemma Model Matrix (detectHardware & resolveRecommendedGemmaModel)', () => {
    it('detects NVIDIA RTX 4060 8GB VRAM as tier "high" and recommends gemma2:9b', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('nvidia-smi')) {
          return 'NVIDIA GeForce RTX 4060 Laptop GPU, 8188 MiB, 551.76\n';
        }
        return '';
      });

      const hw = detectHardware();
      expect(hw.gpu).toBe('NVIDIA GeForce RTX 4060 Laptop GPU');
      expect(hw.vramMB).toBe(8188);
      expect(hw.tier).toBe('high');
      expect(hw.isNvidia).toBe(true);
      expect(hw.isCpuOnly).toBe(false);
      expect(hw.driverVersion).toBe('551.76');

      const recommendation = resolveRecommendedGemmaModel(hw.tier);
      expect(recommendation.primary).toBe('gemma2:9b');
      expect(recommendation.fallback).toBe('gemma2:2b');
      expect(recommendation.contextTokens).toBe(8192);
    });

    it('detects NVIDIA RTX 4090 24GB VRAM as tier "ultra" and recommends gemma2:9b', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('nvidia-smi')) {
          return 'NVIDIA GeForce RTX 4090, 24576 MiB, 555.42\n';
        }
        return '';
      });

      const hw = detectHardware();
      expect(hw.vramMB).toBe(24576);
      expect(hw.tier).toBe('ultra');

      const recommendation = resolveRecommendedGemmaModel(hw.tier);
      expect(recommendation.primary).toBe('gemma2:9b');
      expect(recommendation.contextTokens).toBe(8192);
    });

    it('detects mid-tier GPU (4GB - 6GB VRAM) as tier "mid" and recommends gemma3:4b', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('nvidia-smi')) {
          return 'NVIDIA GeForce GTX 1650, 4096 MiB, 535.12\n';
        }
        return '';
      });

      const hw = detectHardware();
      expect(hw.vramMB).toBe(4096);
      expect(hw.tier).toBe('mid');

      const recommendation = resolveRecommendedGemmaModel(hw.tier);
      expect(recommendation.primary).toBe('gemma3:4b');
      expect(recommendation.fallback).toBe('gemma2:2b');
      expect(recommendation.contextTokens).toBe(8192);
    });

    it('detects low VRAM GPU (<4GB) as tier "low" and recommends gemma2:2b', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('nvidia-smi')) {
          return 'NVIDIA GeForce MX350, 2048 MiB, 510.06\n';
        }
        return '';
      });

      const hw = detectHardware();
      expect(hw.vramMB).toBe(2048);
      expect(hw.tier).toBe('low');

      const recommendation = resolveRecommendedGemmaModel(hw.tier);
      expect(recommendation.primary).toBe('gemma2:2b');
      expect(recommendation.fallback).toBe('gemma2:2b');
      expect(recommendation.contextTokens).toBe(4096);
    });

    it('falls back cleanly to CPU-only tier "low" when no discrete GPU is found', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation(() => {
        throw new Error('Command failed: nvidia-smi');
      });

      const hw = detectHardware();
      expect(hw.isCpuOnly).toBe(true);
      expect(hw.tier).toBe('low');
      expect(hw.vramMB).toBe(0);
      expect(hw.gpu).toContain('CPU Only');

      const recommendation = resolveRecommendedGemmaModel(hw.tier);
      expect(recommendation.primary).toBe('gemma2:2b');
      expect(recommendation.contextTokens).toBe(4096);
    });

    it('verifies next-gen experimental Gemma 4 models in GEMMA_MODEL_CATALOG', () => {
      expect(GEMMA_MODEL_CATALOG['gemma4:e2b']).toBeDefined();
      expect(GEMMA_MODEL_CATALOG['gemma4:e2b'].isGemma4).toBe(true);
      expect(GEMMA_MODEL_CATALOG['gemma4:e2b'].tier).toBe('low');
      expect(GEMMA_MODEL_CATALOG['gemma4:e2b'].recommendedContextTokens).toBe(4096);

      expect(GEMMA_MODEL_CATALOG['gemma4:e4b']).toBeDefined();
      expect(GEMMA_MODEL_CATALOG['gemma4:e4b'].isGemma4).toBe(true);
      expect(GEMMA_MODEL_CATALOG['gemma4:e4b'].tier).toBe('mid');
      expect(GEMMA_MODEL_CATALOG['gemma4:e4b'].recommendedContextTokens).toBe(8192);
    });
  });

  // ── Step 1: Directory Trust Gate ─────────────────────────────────────────
  describe('Step 1: Directory Trust Gate', () => {
    it('automatically confirms trust in headless / automated mode (--yes or --non-interactive)', async () => {
      const promptSpy = vi.spyOn(inquirer, 'prompt');

      // Stub fetch for Ollama checks
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          const u = String(url);
          if (u.includes('/api/tags')) {
            return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 });
          }
          if (u.includes('/api/generate')) {
            return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 10, eval_duration: 500_000_000 }), {
              status: 200,
            });
          }
          return new Response('Not found', { status: 404 });
        }),
      );

      vi.spyOn(child_process, 'execSync').mockReturnValue('');

      const config = await runOasisInit({
        cwd: tmpDir,
        nonInteractive: true,
        yes: true,
      });

      expect(config).toBeDefined();
      expect(config.oasisRoot).toBe(tmpDir);
      expect(promptSpy).not.toHaveBeenCalled();
    });

    it('prompts user for trust confirmation in interactive mode and proceeds when true', async () => {
      const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({
        trust: true,
        modelChoice: 'gemma2:9b',
        preset: 'team',
      } as any);

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          const u = String(url);
          if (u.includes('/api/tags')) {
            return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 });
          }
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 5, eval_duration: 200_000_000 }), {
            status: 200,
          });
        }),
      );

      vi.spyOn(child_process, 'execSync').mockReturnValue('');

      const config = await runOasisInit({ cwd: tmpDir });
      expect(config).toBeDefined();
      expect(promptSpy).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'trust' })]));
    });

    it('aborts cleanly with process.exit(0) when user declines directory trust in interactive mode', async () => {
      vi.spyOn(inquirer, 'prompt').mockResolvedValueOnce({ trust: false } as any);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: any) => {
        throw new Error(`process.exit: ${code}`);
      }) as any);

      await expect(runOasisInit({ cwd: tmpDir })).rejects.toThrow('process.exit: 0');

      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(fs.existsSync(getOasisConfigPath(tmpDir))).toBe(false);
    });

    it('throws error in non-interactive mode if directory is already initialized without --force', async () => {
      // Seed existing config
      const initialConfig: MaosOasisConfig = {
        version: '1.0.0',
        oasisRoot: tmpDir,
        hardware: { gpu: 'CPU', vramMB: 0, tier: 'low' },
        model: { primary: 'gemma2:2b', fallback: 'gemma2:2b', tag: 'gemma2:2b', contextTokens: 4096 },
        ollama: { host: '127.0.0.1', port: 11434, autoStart: true },
        dependencies: {
          herdr: { available: false, multiPaneEnabled: false },
          opencode: { available: false, harnessEnabled: false },
        },
        team: { preset: 'solo', leadModel: 'gemma2:2b', workerModel: 'gemma2:2b', reviewerModel: 'gemma2:2b' },
      };
      saveOasisConfig(initialConfig, tmpDir);

      await expect(runOasisInit({ cwd: tmpDir, nonInteractive: true })).rejects.toThrow(
        /Directory is already initialized with MAOS Oasis.*Use --force to overwrite/,
      );
    });

    it('overwrites existing config when --force is supplied in non-interactive mode', async () => {
      const initialConfig: MaosOasisConfig = {
        version: '0.9.0',
        oasisRoot: tmpDir,
        hardware: { gpu: 'CPU', vramMB: 0, tier: 'low' },
        model: { primary: 'gemma2:2b', fallback: 'gemma2:2b', tag: 'gemma2:2b', contextTokens: 4096 },
        ollama: { host: '127.0.0.1', port: 11434, autoStart: true },
        dependencies: {
          herdr: { available: false, multiPaneEnabled: false },
          opencode: { available: false, harnessEnabled: false },
        },
        team: { preset: 'solo', leadModel: 'gemma2:2b', workerModel: 'gemma2:2b', reviewerModel: 'gemma2:2b' },
      };
      saveOasisConfig(initialConfig, tmpDir);

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 })),
      );
      vi.spyOn(child_process, 'execSync').mockReturnValue('');

      const updated = await runOasisInit({
        cwd: tmpDir,
        nonInteractive: true,
        force: true,
        model: 'gemma2:9b',
      });

      expect(updated.version).toBe('1.0.0');
      expect(updated.model.primary).toBe('gemma2:9b');
    });

    it('returns existing config in interactive mode when user chooses "keep"', async () => {
      const existingConfig: MaosOasisConfig = {
        version: '1.0.0',
        oasisRoot: tmpDir,
        hardware: { gpu: 'Preserved GPU', vramMB: 8188, tier: 'high' },
        model: { primary: 'gemma2:9b', fallback: 'gemma2:2b', tag: 'gemma2:9b', contextTokens: 8192 },
        ollama: { host: '127.0.0.1', port: 11434, autoStart: true },
        dependencies: {
          herdr: { available: true, multiPaneEnabled: true },
          opencode: { available: true, harnessEnabled: true },
        },
        team: { preset: 'duo', leadModel: 'gemma2:9b', workerModel: 'gemma2:9b', reviewerModel: 'gemma2:9b' },
      };
      saveOasisConfig(existingConfig, tmpDir);

      vi.spyOn(inquirer, 'prompt').mockResolvedValueOnce({ action: 'keep' } as any);

      const res = await runOasisInit({ cwd: tmpDir });
      expect(res.hardware.gpu).toBe('Preserved GPU');
      expect(res.team.preset).toBe('duo');
    });
  });

  // ── Step 2: Ollama Liveness & Daemon Startup ─────────────────────────────
  describe('Step 2: Ollama Daemon Liveness & Connectivity', () => {
    it('detects live Ollama daemon and bypasses background startup', async () => {
      const spawnSpy = vi.spyOn(child_process, 'spawn');

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          const u = String(url);
          if (u.includes('/api/tags')) {
            return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 });
          }
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 5, eval_duration: 100_000_000 }), {
            status: 200,
          });
        }),
      );
      vi.spyOn(child_process, 'execSync').mockReturnValue('');

      await runOasisInit({ cwd: tmpDir, nonInteractive: true, yes: true });

      expect(spawnSpy).not.toHaveBeenCalledWith(expect.anything(), ['serve'], expect.anything());
    });

    it('starts Ollama daemon automatically when stopped and --yes is supplied', async () => {
      const spawnSpy = vi.spyOn(child_process, 'spawn').mockReturnValue({ unref: vi.fn() } as any);
      vi.spyOn(child_process, 'execSync').mockReturnValue(
        process.platform === 'win32' ? 'C:\\Program Files\\Ollama\\ollama.exe\n' : '/usr/bin/ollama\n',
      );
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      let pings = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          const u = String(url);
          if (u.includes('/api/tags')) {
            pings++;
            if (pings <= 1) throw new Error('Daemon stopped');
            return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 });
          }
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 5, eval_duration: 100_000_000 }), {
            status: 200,
          });
        }),
      );

      await runOasisInit({ cwd: tmpDir, yes: true });
      expect(spawnSpy).toHaveBeenCalled();
    });

    it('throws descriptive error in non-interactive mode when Ollama is not installed', async () => {
      vi.spyOn(child_process, 'execSync').mockImplementation(() => {
        throw new Error('where/which ollama failed');
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('Connection refused');
        }),
      );

      await expect(runOasisInit({ cwd: tmpDir, nonInteractive: true })).rejects.toThrow(
        /Ollama is not installed\. Please install Ollama from https:\/\/ollama\.com\/download/,
      );
    });
  });

  // ── Step 3 & 4: Model Selection, Pulling & Generation Probe ─────────────
  describe('Step 3 & 4: Gemma Model Selection, Pulling, & Generation Probe', () => {
    it('selects hardware-recommended model by default in automated mode', async () => {
      // Simulate RTX 4060
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('nvidia-smi')) {
          return 'NVIDIA GeForce RTX 4060 Laptop GPU, 8188 MiB, 551.76\n';
        }
        return '';
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          if (String(url).includes('/api/tags')) {
            return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 });
          }
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 20, eval_duration: 1_000_000_000 }), {
            status: 200,
          });
        }),
      );

      const config = await runOasisInit({ cwd: tmpDir, nonInteractive: true });
      expect(config.model.primary).toBe('gemma2:9b');
      expect(config.model.contextTokens).toBe(8192);
    });

    it('honors explicit --model CLI override flag regardless of hardware tier', async () => {
      // Simulate CPU low-tier
      vi.spyOn(child_process, 'execSync').mockReturnValue('');

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          if (String(url).includes('/api/tags')) {
            return new Response(JSON.stringify({ models: [{ name: 'gemma4:e4b' }] }), { status: 200 });
          }
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 10, eval_duration: 500_000_000 }), {
            status: 200,
          });
        }),
      );

      const config = await runOasisInit({
        cwd: tmpDir,
        nonInteractive: true,
        model: 'gemma4:e4b',
      });

      expect(config.model.primary).toBe('gemma4:e4b');
      expect(config.model.tag).toBe('gemma4:e4b');
    });

    it('pulls model via spawnSync when model is not yet present in Ollama', async () => {
      const spawnSyncSpy = vi.spyOn(child_process, 'spawnSync').mockReturnValue({ status: 0 } as any);
      vi.spyOn(child_process, 'execSync').mockReturnValue('');

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          if (String(url).includes('/api/tags')) {
            return new Response(JSON.stringify({ models: [] }), { status: 200 }); // empty tags
          }
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 5, eval_duration: 200_000_000 }), {
            status: 200,
          });
        }),
      );

      await runOasisInit({ cwd: tmpDir, nonInteractive: true, model: 'gemma2:2b' });

      expect(spawnSyncSpy).toHaveBeenCalledWith(expect.anything(), ['pull', 'gemma2:2b'], expect.anything());
    });

    it('skips model pull when --skip-pull option is passed', async () => {
      const spawnSyncSpy = vi.spyOn(child_process, 'spawnSync');
      vi.spyOn(child_process, 'execSync').mockReturnValue('');

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          if (String(url).includes('/api/tags')) {
            return new Response(JSON.stringify({ models: [] }), { status: 200 });
          }
          return new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 5, eval_duration: 200_000_000 }), {
            status: 200,
          });
        }),
      );

      await runOasisInit({ cwd: tmpDir, nonInteractive: true, skipPull: true, model: 'gemma2:2b' });

      expect(spawnSyncSpy).not.toHaveBeenCalledWith(expect.anything(), ['pull', 'gemma2:2b'], expect.anything());
    });

    it('prompts user and downgrades to gemma2:2b in interactive mode if generation probe fails', async () => {
      vi.spyOn(inquirer, 'prompt').mockImplementation(async (questions: any) => {
        const q = Array.isArray(questions) ? questions[0] : questions;
        if (q.name === 'trust') return { trust: true };
        if (q.name === 'modelChoice') return { modelChoice: 'gemma2:9b' };
        if (q.name === 'action') return { action: 'downgrade' };
        if (q.name === 'preset') return { preset: 'team' };
        return {};
      });

      vi.spyOn(child_process, 'execSync').mockReturnValue('');

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          const u = String(url);
          if (u.includes('/api/tags')) {
            return new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }, { name: 'gemma2:2b' }] }), {
              status: 200,
            });
          }
          if (u.includes('/api/generate')) {
            return new Response('VRAM allocation failure', { status: 500 });
          }
          return new Response('Not found', { status: 404 });
        }),
      );

      const config = await runOasisInit({ cwd: tmpDir });
      expect(config.model.primary).toBe(DEFAULT_FALLBACK_MODEL); // 'gemma2:2b'
    });
  });

  // ── Step 5: Companion Toolchain Detection ────────────────────────────────
  describe('Step 5: Companion Toolchain Detection (Herdr & OpenCode)', () => {
    it('enables multiPane and harness features when Herdr and OpenCode are available', async () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('herdr --version')) return 'herdr 0.3.1\n';
        if (cmd.includes('opencode --version')) return 'opencode 1.0.4\n';
        return '';
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'gemma2:2b' }] }), { status: 200 })),
      );

      const config = await runOasisInit({ cwd: tmpDir, nonInteractive: true, model: 'gemma2:2b' });

      expect(config.dependencies.herdr.available).toBe(true);
      expect(config.dependencies.herdr.multiPaneEnabled).toBe(true);
      expect(config.dependencies.opencode.available).toBe(true);
      expect(config.dependencies.opencode.harnessEnabled).toBe(true);
    });

    it('sets toolchains disabled with fallback modes active when Herdr and OpenCode are absent', async () => {
      vi.spyOn(child_process, 'execSync').mockImplementation(() => {
        throw new Error('command not found');
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'gemma2:2b' }] }), { status: 200 })),
      );

      const config = await runOasisInit({ cwd: tmpDir, nonInteractive: true, model: 'gemma2:2b' });

      expect(config.dependencies.herdr.available).toBe(false);
      expect(config.dependencies.herdr.multiPaneEnabled).toBe(false);
      expect(config.dependencies.opencode.available).toBe(false);
      expect(config.dependencies.opencode.harnessEnabled).toBe(false);
    });
  });

  // ── Step 6: Team Preset Selection & Configuration Persistence ───────────
  describe('Step 6: Team Preset Selection & Configuration Persistence', () => {
    it('defaults to "team" preset in automated mode when no preset is specified', async () => {
      vi.spyOn(child_process, 'execSync').mockReturnValue('');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 })),
      );

      const config = await runOasisInit({ cwd: tmpDir, nonInteractive: true });
      expect(config.team.preset).toBe('team');
      expect(config.team.leadModel).toBe(config.model.primary);
      expect(config.team.workerModel).toBe(config.model.primary);
      expect(config.team.reviewerModel).toBe(DEFAULT_FALLBACK_MODEL);
    });

    it('supports explicit --preset solo flag for single-agent sequential coding', async () => {
      vi.spyOn(child_process, 'execSync').mockReturnValue('');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'gemma2:2b' }] }), { status: 200 })),
      );

      const config = await runOasisInit({
        cwd: tmpDir,
        nonInteractive: true,
        preset: 'solo',
        model: 'gemma2:2b',
      });

      expect(config.team.preset).toBe('solo');
      expect(TEAM_PRESETS.solo.members).toHaveLength(1);
    });

    it('supports explicit --preset duo flag for architect + reviewer pairing', async () => {
      vi.spyOn(child_process, 'execSync').mockReturnValue('');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 })),
      );

      const config = await runOasisInit({
        cwd: tmpDir,
        nonInteractive: true,
        preset: 'duo',
        model: 'gemma2:9b',
      });

      expect(config.team.preset).toBe('duo');
      expect(TEAM_PRESETS.duo.members).toHaveLength(2);
    });

    it('writes valid ./maos-oasis.config.json and initializes ./.maos-oasis/ filesystem structure', async () => {
      vi.spyOn(child_process, 'execSync').mockReturnValue('');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 })),
      );

      const returnedConfig = await runOasisInit({ cwd: tmpDir, nonInteractive: true });

      // Check config file on disk
      const configPath = getOasisConfigPath(tmpDir);
      expect(fs.existsSync(configPath)).toBe(true);

      const loadedOnDisk = loadOasisConfig(tmpDir);
      expect(loadedOnDisk).toEqual(returnedConfig);

      // Check runtime directories on disk
      const runtimeDir = getOasisRuntimeDir(tmpDir);
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'pending'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'active'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'done'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'queue', 'failed'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'logs'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, 'status'))).toBe(true);
      expect(fs.existsSync(path.join(runtimeDir, '.gitignore'))).toBe(true);
    });

    it('initializes local git repository if .git directory does not exist', async () => {
      const execSyncSpy = vi.spyOn(child_process, 'execSync').mockReturnValue('');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }] }), { status: 200 })),
      );

      await runOasisInit({ cwd: tmpDir, nonInteractive: true });
      expect(execSyncSpy).toHaveBeenCalledWith('git init', expect.objectContaining({ cwd: tmpDir }));
    });
  });

  // ── Standalone Utility Probes ───────────────────────────────────────────
  describe('Standalone Init Utilities', () => {
    it('isOllamaReachable returns true when /api/tags responds ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('ok', { status: 200 })),
      );
      expect(await isOllamaReachable('127.0.0.1', 11434)).toBe(true);
    });

    it('isOllamaReachable returns false on fetch exception', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('Network error');
        }),
      );
      expect(await isOllamaReachable('127.0.0.1', 11434)).toBe(false);
    });

    it('getLocalOllamaModels extracts array of model names', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ models: [{ name: 'gemma2:9b' }, { name: 'gemma2:2b' }] }), {
              status: 200,
            }),
        ),
      );
      const models = await getLocalOllamaModels();
      expect(models).toEqual(['gemma2:9b', 'gemma2:2b']);
    });

    it('probeGemmaGeneration calculates tokensPerSecond accurately', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ response: 'OASIS_OK', eval_count: 25, eval_duration: 1_000_000_000 }), {
              status: 200,
            }),
        ),
      );
      const probe = await probeGemmaGeneration('gemma2:9b');
      expect(probe.success).toBe(true);
      expect(probe.tokensPerSecond).toBe(25.0);
      expect(probe.output).toBe('OASIS_OK');
    });

    it('probeGemmaGeneration handles API failure gracefully', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('Server Error', { status: 500 })),
      );
      const probe = await probeGemmaGeneration('gemma2:9b');
      expect(probe.success).toBe(false);
      expect(probe.tokensPerSecond).toBe(0);
      expect(probe.error).toContain('HTTP 500');
    });

    it('checkHerdr returns available and version when installed', () => {
      vi.spyOn(child_process, 'execSync').mockReturnValue('herdr 0.4.0\n');
      const info = checkHerdr();
      expect(info.available).toBe(true);
      expect(info.version).toBe('herdr 0.4.0');
    });

    it('checkOpenCode returns available and version when installed', () => {
      vi.spyOn(child_process, 'execSync').mockReturnValue('opencode 1.2.0\n');
      const info = checkOpenCode();
      expect(info.available).toBe(true);
      expect(info.version).toBe('opencode 1.2.0');
    });
  });
});
