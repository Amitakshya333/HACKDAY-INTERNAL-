/**
 * MAOS Oasis — Config & Runtime State Unit Test Suite
 *
 * Hermetic Vitest test suite for src/oasis/config.ts:
 *   1. Constants & Error Hierarchy
 *   2. Config & Runtime Path Resolution
 *   3. Sovereign Loopback OpSec Verification & Enforcement
 *   4. Configuration Schema Validation & Boundary Rules
 *   5. Configuration Loading & Deserialization
 *   6. Configuration Persistence & Formatting
 *   7. Runtime Directory Initialization (.maos-oasis)
 *   8. Gitignore Hardening & Idempotency
 *   9. Default Config Factory (Hardware Matrix, Gemma Models, Team Presets)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  OASIS_CONFIG_FILE,
  OASIS_RUNTIME_DIR,
  OASIS_CURRENT_VERSION,
  OasisConfigError,
  OasisOpSecError,
  getOasisConfigPath,
  getOasisRuntimeDir,
  getOasisQueueDir,
  getOasisLogsDir,
  getOasisStatusDir,
  isOasisInitialized,
  isLoopbackHost,
  assertLoopbackHost,
  validateOasisConfig,
  loadOasisConfig,
  saveOasisConfig,
  ensureOasisRuntimeDirs,
  hardenOasisGitignore,
  createDefaultOasisConfig,
} from '../../src/oasis/config';

import { MaosOasisConfig, HardwareProfile, HardwareTier, TeamPresetId } from '../../src/oasis/types';

describe('Oasis Config Suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const createValidConfigFixture = (dir: string = tmpDir): MaosOasisConfig => ({
    version: OASIS_CURRENT_VERSION,
    oasisRoot: dir,
    hardware: {
      gpu: 'NVIDIA GeForce RTX 4060 Laptop GPU',
      vramMB: 8188,
      tier: 'high',
    },
    model: {
      primary: 'gemma2:9b',
      fallback: 'gemma2:2b',
      tag: 'gemma2:9b',
      contextTokens: 8192,
    },
    ollama: {
      host: '127.0.0.1',
      port: 11434,
      autoStart: true,
    },
    dependencies: {
      herdr: {
        available: true,
        multiPaneEnabled: true,
      },
      opencode: {
        available: true,
        harnessEnabled: true,
      },
    },
    team: {
      preset: 'duo',
      leadModel: 'gemma2:9b',
      workerModel: 'gemma2:9b',
      reviewerModel: 'gemma2:9b',
    },
  });

  // ── 1. Constants & Error Hierarchy ────────────────────────────────────────

  describe('1. Constants & Error Hierarchy', () => {
    it('defines standard constant filenames and version string', () => {
      expect(OASIS_CONFIG_FILE).toBe('maos-oasis.config.json');
      expect(OASIS_RUNTIME_DIR).toBe('.maos-oasis');
      expect(OASIS_CURRENT_VERSION).toBe('1.0.0');
    });

    it('instantiates OasisConfigError with correct prefix, name, and optional cause', () => {
      const errNoCause = new OasisConfigError('Parsing failure');
      expect(errNoCause).toBeInstanceOf(Error);
      expect(errNoCause).toBeInstanceOf(OasisConfigError);
      expect(errNoCause.name).toBe('OasisConfigError');
      expect(errNoCause.message).toBe('[OasisConfigError] Parsing failure');
      expect(errNoCause.cause).toBeUndefined();

      const underlying = new Error('Disk read timeout');
      const errWithCause = new OasisConfigError('I/O error', underlying);
      expect(errWithCause.cause).toBe(underlying);
    });

    it('instantiates OasisOpSecError with loopback violation prefix and name', () => {
      const err = new OasisOpSecError('Hostile endpoint 10.0.0.1');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(OasisOpSecError);
      expect(err.name).toBe('OasisOpSecError');
      expect(err.message).toBe('[OasisOpSecError] Loopback security violation: Hostile endpoint 10.0.0.1');
    });
  });

  // ── 2. Config & Runtime Path Resolution ───────────────────────────────────

  describe('2. Path Resolution & Initialization Check', () => {
    it('resolves config file path with explicit cwd', () => {
      const resolved = getOasisConfigPath(tmpDir);
      expect(resolved).toBe(path.resolve(tmpDir, OASIS_CONFIG_FILE));
    });

    it('resolves config file path defaulting to process.cwd() when omitted', () => {
      const resolved = getOasisConfigPath();
      expect(resolved).toBe(path.resolve(process.cwd(), OASIS_CONFIG_FILE));
    });

    it('resolves runtime directory path with explicit cwd and default process.cwd()', () => {
      expect(getOasisRuntimeDir(tmpDir)).toBe(path.resolve(tmpDir, OASIS_RUNTIME_DIR));
      expect(getOasisRuntimeDir()).toBe(path.resolve(process.cwd(), OASIS_RUNTIME_DIR));
    });

    it('resolves subdirectories: queue, logs, and status under runtime directory', () => {
      const baseRuntime = path.resolve(tmpDir, OASIS_RUNTIME_DIR);
      expect(getOasisQueueDir(tmpDir)).toBe(path.join(baseRuntime, 'queue'));
      expect(getOasisLogsDir(tmpDir)).toBe(path.join(baseRuntime, 'logs'));
      expect(getOasisStatusDir(tmpDir)).toBe(path.join(baseRuntime, 'status'));
    });

    it('isOasisInitialized returns false when config is absent and true when present', () => {
      expect(isOasisInitialized(tmpDir)).toBe(false);

      const configPath = getOasisConfigPath(tmpDir);
      fs.writeFileSync(configPath, JSON.stringify(createValidConfigFixture(tmpDir)), 'utf-8');

      expect(isOasisInitialized(tmpDir)).toBe(true);
    });
  });

  // ── 3. Sovereign Loopback OpSec Gate ──────────────────────────────────────

  describe('3. Sovereign Loopback OpSec (isLoopbackHost & assertLoopbackHost)', () => {
    it('isLoopbackHost accepts legitimate loopback addresses and bracketed forms', () => {
      const validHosts = [
        '127.0.0.1',
        '127.0.0.2',
        '127.1.2.3',
        '127.255.255.254',
        '[127.0.0.1]',
        'localhost',
        'LOCALHOST',
        '  localhost  ',
        '::1',
        '[::1]',
        '0:0:0:0:0:0:0:1',
      ];

      for (const host of validHosts) {
        expect(isLoopbackHost(host), `Expected loopback to be accepted: ${host}`).toBe(true);
      }
    });

    it('isLoopbackHost strictly rejects LAN, cloud, external DNS, and deceptive hostnames', () => {
      const hostileHosts = [
        '192.168.1.1',
        '192.168.0.100',
        '10.0.0.1',
        '172.16.0.1',
        '169.254.169.254',
        '8.8.8.8',
        '1.1.1.1',
        '0.0.0.0',
        '::',
        'fe80::1',
        '2001:db8::1',
        'api.openai.com',
        'api.anthropic.com',
        'generativelanguage.googleapis.com',
        'evil.com',
        'localhost.evil.com',
        'evil-localhost.com',
        '127.0.0.1.nip.io',
        '',
        '   ',
        '127.0.0',
        '127.0.0.1.1',
        'not_an_ip',
        null as unknown as string,
        undefined as unknown as string,
        127001 as unknown as string,
      ];

      for (const host of hostileHosts) {
        expect(isLoopbackHost(host), `Expected hostile host to be rejected: ${host}`).toBe(false);
      }
    });

    it('assertLoopbackHost allows valid loopback hostnames and HTTP URLs without error', () => {
      const validTargets = [
        '127.0.0.1',
        'localhost',
        '::1',
        'http://127.0.0.1:11434',
        'http://localhost:11434',
        'http://[::1]:11434',
        'http://127.0.0.5:8080/api/tags',
      ];

      for (const target of validTargets) {
        expect(() => assertLoopbackHost(target, 'TestModule')).not.toThrow();
      }
    });

    it('assertLoopbackHost throws OasisOpSecError for non-loopback hosts and remote URLs', () => {
      const hostileTargets = [
        '192.168.1.5',
        'api.openai.com',
        '0.0.0.0',
        'http://192.168.1.50:11434',
        'https://api.openai.com/v1',
        'http://localhost.evil.com:11434',
        'http://0.0.0.0:11434',
      ];

      for (const target of hostileTargets) {
        expect(
          () => assertLoopbackHost(target, 'CustomService'),
          `Expected assertLoopbackHost to throw for ${target}`,
        ).toThrow(OasisOpSecError);
      }
    });

    it('assertLoopbackHost includes component label and target host in violation message', () => {
      expect(() => assertLoopbackHost('192.168.1.100', 'VectorStore')).toThrow(
        /VectorStore endpoint host "192\.168\.1\.100" is not a sovereign loopback address/,
      );
    });
  });

  // ── 4. Configuration Schema Validation ───────────────────────────────────

  describe('4. Configuration Schema Validation (validateOasisConfig)', () => {
    it('validates a pristine loopback configuration with zero errors', () => {
      const config = createValidConfigFixture();
      const res = validateOasisConfig(config);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('validates across all recognized hardware tiers: low, mid, high, ultra', () => {
      const tiers: HardwareTier[] = ['low', 'mid', 'high', 'ultra'];
      for (const tier of tiers) {
        const config = {
          ...createValidConfigFixture(),
          hardware: { gpu: 'Test GPU', vramMB: 4096, tier },
        };
        const res = validateOasisConfig(config);
        expect(res.valid, `Expected tier "${tier}" to be valid`).toBe(true);
      }
    });

    it('validates across all team presets: solo, duo, team', () => {
      const presets: TeamPresetId[] = ['solo', 'duo', 'team'];
      for (const preset of presets) {
        const config = {
          ...createValidConfigFixture(),
          team: {
            preset,
            leadModel: 'gemma2:9b',
            workerModel: 'gemma2:9b',
            reviewerModel: 'gemma2:9b',
          },
        };
        const res = validateOasisConfig(config);
        expect(res.valid, `Expected preset "${preset}" to be valid`).toBe(true);
      }
    });

    it('rejects null, primitive, or empty object configurations', () => {
      expect(validateOasisConfig(null).valid).toBe(false);
      expect(validateOasisConfig(undefined).valid).toBe(false);
      expect(validateOasisConfig('string-not-object').valid).toBe(false);

      const emptyRes = validateOasisConfig({});
      expect(emptyRes.valid).toBe(false);
      expect(emptyRes.errors).toContain('Missing or invalid "version"');
      expect(emptyRes.errors).toContain('Missing "hardware" configuration section');
      expect(emptyRes.errors).toContain('Missing "model" configuration section');
      expect(emptyRes.errors).toContain('Missing "ollama" configuration section');
      expect(emptyRes.errors).toContain('Missing "dependencies" configuration section');
      expect(emptyRes.errors).toContain('Missing "team" configuration section');
    });

    it('detects invalid hardware section fields', () => {
      const badTier = {
        ...createValidConfigFixture(),
        hardware: { gpu: 'RTX 4060', vramMB: 8188, tier: 'super-tier' as unknown as HardwareTier },
      };
      expect(validateOasisConfig(badTier).errors.some((e) => e.includes('Invalid "hardware.tier"'))).toBe(true);

      const missingGpu = {
        ...createValidConfigFixture(),
        hardware: { gpu: 123 as unknown as string, vramMB: 8188, tier: 'high' as const },
      };
      expect(validateOasisConfig(missingGpu).errors).toContain('Missing "hardware.gpu"');

      const nonNumVram = {
        ...createValidConfigFixture(),
        hardware: { gpu: 'RTX 4060', vramMB: '8GB' as unknown as number, tier: 'high' as const },
      };
      expect(validateOasisConfig(nonNumVram).errors).toContain('Missing "hardware.vramMB"');
    });

    it('detects missing model configuration fields', () => {
      const badModel = {
        ...createValidConfigFixture(),
        model: { primary: '', fallback: '', tag: '', contextTokens: '8192' as unknown as number },
      };
      const res = validateOasisConfig(badModel);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('Missing "model.primary"');
      expect(res.errors).toContain('Missing "model.fallback"');
      expect(res.errors).toContain('Missing "model.tag"');
      expect(res.errors).toContain('Missing "model.contextTokens"');
    });

    it('detects OpSec violation and port range boundaries in ollama section', () => {
      const badHost = {
        ...createValidConfigFixture(),
        ollama: { host: '192.168.1.1', port: 11434, autoStart: true },
      };
      expect(
        validateOasisConfig(badHost).errors.some((e) => e.includes('OpSec violation: "ollama.host" must be loopback')),
      ).toBe(true);

      const invalidPorts = [0, -1, 65536, 11434.5, NaN, Infinity, '11434' as unknown as number];
      for (const port of invalidPorts) {
        const badPortConfig = {
          ...createValidConfigFixture(),
          ollama: { host: '127.0.0.1', port, autoStart: true },
        };
        expect(
          validateOasisConfig(badPortConfig).errors.some((e) => e.includes('Invalid "ollama.port"')),
          `Expected invalid port rejection for ${port}`,
        ).toBe(true);
      }

      // Valid port boundaries
      const validPorts = [1, 11434, 65535];
      for (const port of validPorts) {
        const validPortConfig = {
          ...createValidConfigFixture(),
          ollama: { host: '127.0.0.1', port, autoStart: true },
        };
        expect(validateOasisConfig(validPortConfig).errors.some((e) => e.includes('Invalid "ollama.port"'))).toBe(
          false,
        );
      }
    });

    it('detects invalid team preset', () => {
      const badPreset = {
        ...createValidConfigFixture(),
        team: {
          preset: 'unlimited-swarm' as unknown as TeamPresetId,
          leadModel: 'gemma2:9b',
          workerModel: 'gemma2:9b',
          reviewerModel: 'gemma2:9b',
        },
      };
      expect(validateOasisConfig(badPreset).errors.some((e) => e.includes('Invalid "team.preset"'))).toBe(true);
    });

    it('strictly detects and rejects cloud API credential leakage in custom config fields', () => {
      const testCases = [
        { openaiApiKey: 'sk-ant-test-123456789' },
        { customSecret: 'my_api_key_value' },
        { cloudConfig: { authKey: 'apikey123' } },
        { SK_TOKEN: 'SK-PROJ-ABCDEF123456' },
      ];

      for (const leak of testCases) {
        const leakyConfig = {
          ...createValidConfigFixture(),
          ...leak,
        };
        const res = validateOasisConfig(leakyConfig);
        expect(res.valid).toBe(false);
        expect(
          res.errors.some((e) => e.includes('Cloud API credentials or keys must not be persisted')),
          `Expected credential leakage rejection for ${JSON.stringify(leak)}`,
        ).toBe(true);
      }
    });
  });

  // ── 5. Configuration Loading & Deserialization ────────────────────────────

  describe('5. Configuration Loading & Deserialization (loadOasisConfig)', () => {
    it('returns null when config file does not exist in target cwd', () => {
      const config = loadOasisConfig(tmpDir);
      expect(config).toBeNull();
    });

    it('loads and returns valid MaosOasisConfig when valid file exists', () => {
      const fixture = createValidConfigFixture(tmpDir);
      const configPath = getOasisConfigPath(tmpDir);
      fs.writeFileSync(configPath, JSON.stringify(fixture, null, 2), 'utf-8');

      const loaded = loadOasisConfig(tmpDir);
      expect(loaded).toBeDefined();
      expect(loaded?.version).toBe(OASIS_CURRENT_VERSION);
      expect(loaded?.hardware.gpu).toBe(fixture.hardware.gpu);
      expect(loaded?.model.primary).toBe('gemma2:9b');
      expect(loaded?.ollama.host).toBe('127.0.0.1');
    });

    it('throws OasisConfigError when config file contains malformed JSON syntax', () => {
      const configPath = getOasisConfigPath(tmpDir);
      fs.writeFileSync(configPath, '{ invalid json syntax, unclosed: true ', 'utf-8');

      expect(() => loadOasisConfig(tmpDir)).toThrow(OasisConfigError);
      expect(() => loadOasisConfig(tmpDir)).toThrow(/Failed to parse/);
    });

    it('throws OasisConfigError when config file fails schema validation', () => {
      const configPath = getOasisConfigPath(tmpDir);
      const invalidJson = { version: '1.0.0', hardware: { gpu: 'RTX 4060' } }; // Missing model, ollama, team, dependencies
      fs.writeFileSync(configPath, JSON.stringify(invalidJson), 'utf-8');

      expect(() => loadOasisConfig(tmpDir)).toThrow(OasisConfigError);
      expect(() => loadOasisConfig(tmpDir)).toThrow(/Invalid Oasis configuration in/);
    });

    it('throws OasisConfigError when config file contains non-loopback host', () => {
      const configPath = getOasisConfigPath(tmpDir);
      const hostileConfig = {
        ...createValidConfigFixture(tmpDir),
        ollama: { host: '192.168.1.99', port: 11434, autoStart: true },
      };
      fs.writeFileSync(configPath, JSON.stringify(hostileConfig), 'utf-8');

      expect(() => loadOasisConfig(tmpDir)).toThrow(OasisConfigError);
      expect(() => loadOasisConfig(tmpDir)).toThrow(/OpSec violation: "ollama.host" must be loopback/);
    });

    it('throws OasisConfigError when config file contains persisted cloud API credentials', () => {
      const configPath = getOasisConfigPath(tmpDir);
      const leakyConfig = {
        ...createValidConfigFixture(tmpDir),
        leakedToken: 'sk-live-0987654321',
      };
      fs.writeFileSync(configPath, JSON.stringify(leakyConfig), 'utf-8');

      expect(() => loadOasisConfig(tmpDir)).toThrow(OasisConfigError);
      expect(() => loadOasisConfig(tmpDir)).toThrow(/Cloud API credentials or keys must not be persisted/);
    });
  });

  // ── 6. Configuration Persistence & Serialization ──────────────────────────

  describe('6. Configuration Persistence & Serialization (saveOasisConfig)', () => {
    it('persists valid configuration with 2-space indentation and trailing newline', () => {
      const fixture = createValidConfigFixture(tmpDir);
      saveOasisConfig(fixture, tmpDir);

      const configPath = getOasisConfigPath(tmpDir);
      expect(fs.existsSync(configPath)).toBe(true);

      const raw = fs.readFileSync(configPath, 'utf-8');
      expect(raw.endsWith('\n')).toBe(true);
      expect(raw).toContain('  "version": "1.0.0"');
      expect(raw).toContain('  "hardware": {');

      const parsed = JSON.parse(raw);
      expect(parsed).toEqual(fixture);
    });

    it('verifies round-trip fidelity between saveOasisConfig and loadOasisConfig', () => {
      const fixture = createValidConfigFixture(tmpDir);
      saveOasisConfig(fixture, tmpDir);

      const loaded = loadOasisConfig(tmpDir);
      expect(loaded).toEqual(fixture);
    });

    it('refuses to save invalid configuration and throws OasisConfigError without writing', () => {
      const invalidConfig = {
        ...createValidConfigFixture(tmpDir),
        hardware: { gpu: 'RTX 4060', vramMB: 8188, tier: 'invalid-tier' as unknown as HardwareTier },
      };

      expect(() => saveOasisConfig(invalidConfig, tmpDir)).toThrow(OasisConfigError);
      expect(() => saveOasisConfig(invalidConfig, tmpDir)).toThrow(/Cannot save invalid Oasis configuration/);

      expect(fs.existsSync(getOasisConfigPath(tmpDir))).toBe(false);
    });

    it('refuses to save configuration with non-loopback host and throws OasisConfigError', () => {
      const hostileConfig = {
        ...createValidConfigFixture(tmpDir),
        ollama: { host: '0.0.0.0', port: 11434, autoStart: true },
      };

      expect(() => saveOasisConfig(hostileConfig, tmpDir)).toThrow(OasisConfigError);
      expect(fs.existsSync(getOasisConfigPath(tmpDir))).toBe(false);
    });

    it('throws OasisConfigError when target write directory is inaccessible', () => {
      const fixture = createValidConfigFixture(tmpDir);
      const unreachableDir = path.join(tmpDir, 'non-existent-subpath', 'nested');

      expect(() => saveOasisConfig(fixture, unreachableDir)).toThrow(OasisConfigError);
      expect(() => saveOasisConfig(fixture, unreachableDir)).toThrow(/Failed to write config file to/);
    });
  });

  // ── 7. Runtime Directory Initialization ───────────────────────────────────

  describe('7. Runtime Directory Initialization (ensureOasisRuntimeDirs)', () => {
    it('creates complete .maos-oasis directory tree including queue subdirectories and logs', () => {
      ensureOasisRuntimeDirs(tmpDir);

      const runtimeDir = getOasisRuntimeDir(tmpDir);
      const queueDir = getOasisQueueDir(tmpDir);
      const logsDir = getOasisLogsDir(tmpDir);
      const statusDir = getOasisStatusDir(tmpDir);

      expect(fs.existsSync(runtimeDir)).toBe(true);
      expect(fs.existsSync(queueDir)).toBe(true);
      expect(fs.existsSync(path.join(queueDir, 'pending'))).toBe(true);
      expect(fs.existsSync(path.join(queueDir, 'active'))).toBe(true);
      expect(fs.existsSync(path.join(queueDir, 'done'))).toBe(true);
      expect(fs.existsSync(path.join(queueDir, 'failed'))).toBe(true);
      expect(fs.existsSync(logsDir)).toBe(true);
      expect(fs.existsSync(statusDir)).toBe(true);
    });

    it('creates internal .maos-oasis/.gitignore to ignore internal state but retain itself', () => {
      ensureOasisRuntimeDirs(tmpDir);

      const innerGitignore = path.join(getOasisRuntimeDir(tmpDir), '.gitignore');
      expect(fs.existsSync(innerGitignore)).toBe(true);

      const content = fs.readFileSync(innerGitignore, 'utf-8');
      expect(content).toBe('*\n!.gitignore\n');
    });

    it('automatically invokes hardenOasisGitignore on parent directory', () => {
      ensureOasisRuntimeDirs(tmpDir);

      const rootGitignore = path.join(tmpDir, '.gitignore');
      expect(fs.existsSync(rootGitignore)).toBe(true);

      const content = fs.readFileSync(rootGitignore, 'utf-8');
      expect(content).toContain('.maos-oasis/');
      expect(content).toContain('.maos-oasis/queue/');
      expect(content).toContain('.maos-oasis/logs/');
      expect(content).toContain('.maos-oasis/status/');
      expect(content).toContain('.maos-oasis/*.log');
    });

    it('operates idempotently when called multiple times in succession', () => {
      ensureOasisRuntimeDirs(tmpDir);
      expect(() => ensureOasisRuntimeDirs(tmpDir)).not.toThrow();
      expect(() => ensureOasisRuntimeDirs(tmpDir)).not.toThrow();

      const innerGitignore = path.join(getOasisRuntimeDir(tmpDir), '.gitignore');
      expect(fs.readFileSync(innerGitignore, 'utf-8')).toBe('*\n!.gitignore\n');
    });
  });

  // ── 8. Root .gitignore Hardening ──────────────────────────────────────────

  describe('8. Root .gitignore Hardening (hardenOasisGitignore)', () => {
    it('creates .gitignore from scratch with runtime header and all required patterns', () => {
      hardenOasisGitignore(tmpDir);

      const gitignorePath = path.join(tmpDir, '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('# MAOS Oasis Runtime Internals (Ephemeral Agent Logs & State)');
      expect(content).toContain('.maos-oasis/\n');
      expect(content).toContain('.maos-oasis/queue/\n');
      expect(content).toContain('.maos-oasis/logs/\n');
      expect(content).toContain('.maos-oasis/status/\n');
      expect(content).toContain('.maos-oasis/*.log\n');
    });

    it('appends required patterns to pre-existing .gitignore while preserving prior rules', () => {
      const gitignorePath = path.join(tmpDir, '.gitignore');
      const priorContent = 'node_modules/\ndist/\n.env\n';
      fs.writeFileSync(gitignorePath, priorContent, 'utf-8');

      hardenOasisGitignore(tmpDir);

      const updated = fs.readFileSync(gitignorePath, 'utf-8');
      expect(updated.startsWith('node_modules/\ndist/\n.env\n')).toBe(true);
      expect(updated).toContain('# MAOS Oasis Runtime Internals');
      expect(updated).toContain('.maos-oasis/');
      expect(updated).toContain('.maos-oasis/*.log');
    });

    it('is strictly idempotent: repeated executions produce identical file length and content', () => {
      hardenOasisGitignore(tmpDir);
      const firstPass = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');

      hardenOasisGitignore(tmpDir);
      const secondPass = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');

      hardenOasisGitignore(tmpDir);
      const thirdPass = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');

      expect(secondPass).toBe(firstPass);
      expect(thirdPass).toBe(firstPass);
    });

    it('normalizes slashes and recognizes existing patterns without duplicate insertion', () => {
      const gitignorePath = path.join(tmpDir, '.gitignore');
      // Existing patterns using Windows backslashes or leading slashes
      fs.writeFileSync(
        gitignorePath,
        '/.maos-oasis/\n.maos-oasis\\queue\\\n.maos-oasis\\logs\\\n.maos-oasis\\status\\\n.maos-oasis\\*.log\n',
        'utf-8',
      );

      hardenOasisGitignore(tmpDir);

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const occurrences = (content.match(/\.maos-oasis/g) || []).length;
      expect(occurrences).toBe(5);
    });
  });

  // ── 9. Default Config Generator ───────────────────────────────────────────

  describe('9. Default Config Generator (createDefaultOasisConfig)', () => {
    it('creates compliant default config with RTX 4060 hardware baseline and gemma2:9b', () => {
      const config = createDefaultOasisConfig({ cwd: tmpDir });

      expect(config.version).toBe(OASIS_CURRENT_VERSION);
      expect(config.oasisRoot).toBe(path.resolve(tmpDir));
      expect(config.hardware.tier).toBe('high');
      expect(config.hardware.gpu).toContain('RTX 4060');
      expect(config.hardware.vramMB).toBe(8188);
      expect(config.model.primary).toBe('gemma2:9b');
      expect(config.model.fallback).toBe('gemma2:2b');
      expect(config.model.tag).toBe('gemma2:9b');
      expect(config.model.contextTokens).toBe(8192);
      expect(config.ollama.host).toBe('127.0.0.1');
      expect(config.ollama.port).toBe(11434);
      expect(config.ollama.autoStart).toBe(true);
      expect(config.team.preset).toBe('duo');
      expect(config.dependencies.herdr.available).toBe(false);
      expect(config.dependencies.opencode.available).toBe(false);

      const validation = validateOasisConfig(config);
      expect(validation.valid).toBe(true);
    });

    it('adapts model recommendations for low tier hardware (CPU or <4GB VRAM)', () => {
      const lowHw: HardwareProfile = {
        gpuName: 'Integrated Graphics / CPU',
        vramMB: 0,
        tier: 'low',
        isNvidia: false,
        isAmd: false,
        isCpuOnly: true,
        totalRamMB: 8192,
      };

      const config = createDefaultOasisConfig({ cwd: tmpDir, hardware: lowHw });
      expect(config.hardware.tier).toBe('low');
      expect(config.model.primary).toBe('gemma2:2b');
      expect(config.model.fallback).toBe('gemma2:2b');
      expect(config.model.contextTokens).toBe(4096);
      expect(validateOasisConfig(config).valid).toBe(true);
    });

    it('adapts model recommendations for mid tier hardware (4-6GB VRAM)', () => {
      const midHw: HardwareProfile = {
        gpuName: 'NVIDIA GeForce RTX 3050',
        vramMB: 4096,
        tier: 'mid',
        isNvidia: true,
        isAmd: false,
        isCpuOnly: false,
        totalRamMB: 16384,
      };

      const config = createDefaultOasisConfig({ cwd: tmpDir, hardware: midHw });
      expect(config.hardware.tier).toBe('mid');
      expect(config.model.primary).toBe('gemma3:4b');
      expect(config.model.fallback).toBe('gemma2:2b');
      expect(config.model.contextTokens).toBe(8192);
      expect(validateOasisConfig(config).valid).toBe(true);
    });

    it('applies custom model selection (including Gemma 4 experimental tags)', () => {
      const gemma4Config = createDefaultOasisConfig({
        cwd: tmpDir,
        selectedModel: 'gemma4:e4b',
        preset: 'team',
      });

      expect(gemma4Config.model.tag).toBe('gemma4:e4b');
      expect(gemma4Config.team.preset).toBe('team');
      expect(gemma4Config.team.leadModel).toBe('gemma4:e4b');
      expect(gemma4Config.team.workerModel).toBe('gemma4:e4b');
      expect(gemma4Config.team.reviewerModel).toBe('gemma4:e4b');
      expect(validateOasisConfig(gemma4Config).valid).toBe(true);
    });

    it('correctly populates solo, duo, and team presets', () => {
      const solo = createDefaultOasisConfig({ cwd: tmpDir, preset: 'solo' });
      expect(solo.team.preset).toBe('solo');

      const duo = createDefaultOasisConfig({ cwd: tmpDir, preset: 'duo' });
      expect(duo.team.preset).toBe('duo');

      const team = createDefaultOasisConfig({ cwd: tmpDir, preset: 'team' });
      expect(team.team.preset).toBe('team');
    });

    it('reflects toolchain availability flags for Herdr and OpenCode', () => {
      const config = createDefaultOasisConfig({
        cwd: tmpDir,
        herdrAvailable: true,
        opencodeAvailable: true,
      });

      expect(config.dependencies.herdr.available).toBe(true);
      expect(config.dependencies.herdr.multiPaneEnabled).toBe(true);
      expect(config.dependencies.opencode.available).toBe(true);
      expect(config.dependencies.opencode.harnessEnabled).toBe(true);
      expect(validateOasisConfig(config).valid).toBe(true);
    });
  });
});
