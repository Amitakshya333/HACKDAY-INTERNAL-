/**
 * Empirical Challenger Stress Harness for Milestone 1
 * Tests:
 * 1. CLI entrypoint routing (bare command auto-routes to init)
 * 2. Non-interactive init wizard (schema, .maos-oasis dirs, .gitignore hardening)
 * 3. Presets & re-initialization guards
 * 4. Config validation and corruption handling (tiers, remote hosts, injected keys, malformed JSON)
 * 5. Doctor diagnostics on corrupt vs valid configs, and auto-repair via --fix
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');
const assert = require('assert');

// Import compiled oasis modules
const oasisPath = path.resolve(__dirname, '../dist/oasis');
const {
  loadOasisConfig,
  saveOasisConfig,
  validateOasisConfig,
  isLoopbackHost,
  assertLoopbackHost,
  ensureOasisRuntimeDirs,
  hardenOasisGitignore,
  createDefaultOasisConfig,
  getOasisConfigPath,
  getOasisRuntimeDir,
  OasisConfigError,
  OasisOpSecError,
} = require(path.join(oasisPath, 'config.js'));

const {
  HARDWARE_TIER_THRESHOLDS,
  GEMMA_MODEL_CATALOG,
  resolveRecommendedGemmaModel,
  TEAM_PRESETS,
} = require(path.join(oasisPath, 'types.js'));

const {
  checkNodeVersion,
  checkConfigAndRuntime,
  checkLoopbackOpSec,
  runOasisDoctor,
} = require(path.join(oasisPath, 'doctor.js'));

const CLI_BIN = path.resolve(oasisPath, 'oasis-cli.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const results = [];

function recordResult(category, testName, passed, details = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.log(`  ✗ [FAIL] ${testName}: ${details}`);
  }
  results.push({ category, testName, passed, details });
}

function makeTempDir(prefix = 'oasis-stress-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

async function runAllTests() {
  console.log('================================================================');
  console.log('   EMPIRICAL CHALLENGER: MILESTONE 1 ADVERSARIAL STRESS SUITE   ');
  console.log('================================================================\n');

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 1: CLI Entrypoint Routing & Bare Invocation
  // ──────────────────────────────────────────────────────────────────────────
  console.log('--- SUITE 1: CLI Entrypoint Routing ---');
  {
    const tempDir = makeTempDir('oasis-bare-routing-');
    try {
      // In a clean directory with NO config, invoke bare `node dist/oasis/oasis-cli.js`
      // We pass an empty input stream so inquirer closes/aborts after init is auto-invoked
      const res = child_process.spawnSync(process.execPath, [CLI_BIN], {
        cwd: tempDir,
        input: '\n',
        encoding: 'utf-8',
        timeout: 15000,
      });

      const combinedOutput = (res.stdout || '') + (res.stderr || '');
      const detectedNotice = combinedOutput.includes('No ./maos-oasis.config.json detected. Starting initialization wizard');
      const step1Reached = combinedOutput.includes('Step 1: Directory Trust Gate') || combinedOutput.includes('MAOS Oasis — Sovereign Multi-Agent Coding Swarm');

      recordResult(
        'CLI Entrypoint Routing',
        'Bare CLI without config auto-routes to initialization wizard',
        detectedNotice && step1Reached,
        `Notice detected: ${detectedNotice}, Step 1 reached: ${step1Reached}, Exit code: ${res.status}`
      );
    } finally {
      cleanTempDir(tempDir);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 2: Non-Interactive Init Wizard
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 2: Non-Interactive Init Wizard ---');
  {
    const tempDir = makeTempDir('oasis-init-solo-');
    try {
      // Test command: node dist/oasis/oasis-cli.js init --yes --non-interactive --preset solo --skip-pull
      const res = child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'init', '--yes', '--non-interactive', '--preset', 'solo', '--skip-pull'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
          timeout: 60000,
        }
      );

      const exitZero = res.status === 0;
      recordResult(
        'Non-Interactive Init',
        'Init command completes with exit code 0',
        exitZero,
        `Exit code: ${res.status}, stderr: ${res.stderr}`
      );

      // Verify maos-oasis.config.json exists
      const configPath = path.join(tempDir, 'maos-oasis.config.json');
      const configExists = fs.existsSync(configPath);
      recordResult('Non-Interactive Init', 'maos-oasis.config.json is generated at root', configExists);

      let config = null;
      if (configExists) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }

      // Verify schema attributes
      const hasVersion = config && config.version === '1.0.0';
      const hasHardware = config && ['low', 'mid', 'high', 'ultra'].includes(config.hardware?.tier) && typeof config.hardware?.vramMB === 'number';
      const hasModel = config && config.model?.primary && config.model?.fallback && typeof config.model?.contextTokens === 'number';
      const hasLoopbackOllama = config && config.ollama?.host === '127.0.0.1' && config.ollama?.port === 11434;
      const hasSoloPreset = config && config.team?.preset === 'solo' && config.team?.workerModel;

      recordResult('Non-Interactive Init', 'Schema validation: version, hardware, model, ollama loopback, team preset solo',
        Boolean(hasVersion && hasHardware && hasModel && hasLoopbackOllama && hasSoloPreset),
        `version: ${config?.version}, tier: ${config?.hardware?.tier}, preset: ${config?.team?.preset}`
      );

      // Verify runtime directories created in .maos-oasis/
      const expectedDirs = [
        path.join(tempDir, '.maos-oasis'),
        path.join(tempDir, '.maos-oasis', 'queue'),
        path.join(tempDir, '.maos-oasis', 'queue', 'pending'),
        path.join(tempDir, '.maos-oasis', 'queue', 'active'),
        path.join(tempDir, '.maos-oasis', 'queue', 'done'),
        path.join(tempDir, '.maos-oasis', 'queue', 'failed'),
        path.join(tempDir, '.maos-oasis', 'logs'),
        path.join(tempDir, '.maos-oasis', 'status'),
      ];

      const allDirsExist = expectedDirs.every((d) => fs.existsSync(d) && fs.statSync(d).isDirectory());
      recordResult('Non-Interactive Init', 'All 8 runtime directories exist under .maos-oasis/', allDirsExist);

      // Verify internal .maos-oasis/.gitignore
      const internalGitignore = path.join(tempDir, '.maos-oasis', '.gitignore');
      const internalGitignoreOk = fs.existsSync(internalGitignore) && fs.readFileSync(internalGitignore, 'utf-8').includes('*\n!.gitignore');
      recordResult('Non-Interactive Init', 'Internal .maos-oasis/.gitignore created with ignore wildcard', internalGitignoreOk);

      // Verify root .gitignore hardened
      const rootGitignore = path.join(tempDir, '.gitignore');
      const rootGitignoreExists = fs.existsSync(rootGitignore);
      const rootGitignoreContent = rootGitignoreExists ? fs.readFileSync(rootGitignore, 'utf-8') : '';
      const containsRuntimeDir = rootGitignoreContent.includes('.maos-oasis/');
      const doesNotIgnoreConfig = !rootGitignoreContent.includes('maos-oasis.config.json');

      recordResult(
        'Non-Interactive Init',
        'Root .gitignore hardened to ignore .maos-oasis/ while keeping maos-oasis.config.json trackable',
        rootGitignoreExists && containsRuntimeDir && doesNotIgnoreConfig,
        `containsRuntimeDir: ${containsRuntimeDir}, doesNotIgnoreConfig: ${doesNotIgnoreConfig}`
      );
    } finally {
      cleanTempDir(tempDir);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 3: Presets & Re-Initialization Guards
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 3: Presets & Re-Initialization Guards ---');
  {
    // Test presets: duo and team
    const tempDirDuo = makeTempDir('oasis-preset-duo-');
    const tempDirTeam = makeTempDir('oasis-preset-team-');
    try {
      child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'init', '--yes', '--non-interactive', '--preset', 'duo', '--skip-pull'],
        { cwd: tempDirDuo, encoding: 'utf-8', timeout: 60000 }
      );
      const duoConfig = JSON.parse(fs.readFileSync(path.join(tempDirDuo, 'maos-oasis.config.json'), 'utf-8'));
      recordResult('Presets', 'Init with --preset duo configures duo preset', duoConfig.team?.preset === 'duo');

      child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'init', '--yes', '--non-interactive', '--preset', 'team', '--skip-pull'],
        { cwd: tempDirTeam, encoding: 'utf-8', timeout: 60000 }
      );
      const teamConfig = JSON.parse(fs.readFileSync(path.join(tempDirTeam, 'maos-oasis.config.json'), 'utf-8'));
      recordResult('Presets', 'Init with --preset team configures team preset', teamConfig.team?.preset === 'team');

      // Test re-initialization collision guard: without --force, non-interactive must fail
      const repeatRes = child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'init', '--non-interactive', '--skip-pull'],
        { cwd: tempDirDuo, encoding: 'utf-8', timeout: 25000 }
      );
      const collisionGuarded = repeatRes.status !== 0 && ((repeatRes.stdout || '') + (repeatRes.stderr || '')).includes('already initialized');
      recordResult('Re-Init Guard', 'Re-init in existing directory without --force or --yes fails non-interactively', collisionGuarded);

      // Re-init with --force must succeed
      const forceRes = child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'init', '--force', '--non-interactive', '--preset', 'solo', '--skip-pull'],
        { cwd: tempDirDuo, encoding: 'utf-8', timeout: 60000 }
      );
      const forceOverwritten = forceRes.status === 0;
      const overwrittenConfig = JSON.parse(fs.readFileSync(path.join(tempDirDuo, 'maos-oasis.config.json'), 'utf-8'));
      recordResult('Re-Init Guard', 'Re-init with --force successfully overwrites configuration', forceOverwritten && overwrittenConfig.team?.preset === 'solo');

      // Test .gitignore idempotency: harden 5 times and check lines don't multiply
      const initialGitignoreLines = fs.readFileSync(path.join(tempDirDuo, '.gitignore'), 'utf-8').trim().split('\n').length;
      for (let i = 0; i < 5; i++) {
        hardenOasisGitignore(tempDirDuo);
      }
      const postGitignoreLines = fs.readFileSync(path.join(tempDirDuo, '.gitignore'), 'utf-8').trim().split('\n').length;
      recordResult('Gitignore Idempotency', 'Repeated hardenOasisGitignore calls are strictly idempotent', initialGitignoreLines === postGitignoreLines);
    } finally {
      cleanTempDir(tempDirDuo);
      cleanTempDir(tempDirTeam);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 4: Config Validation & Corruption Handling
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 4: Config Validation & Corruption Handling ---');
  {
    const tempDir = makeTempDir('oasis-corruption-');
    try {
      // 4.1 Missing file returns null
      const missingConfig = loadOasisConfig(tempDir);
      recordResult('Config Corruption', 'Missing config returns null cleanly without throwing', missingConfig === null);

      // 4.2 Malformed JSON syntax throws OasisConfigError
      const configPath = path.join(tempDir, 'maos-oasis.config.json');
      fs.writeFileSync(configPath, '{ "version": "1.0.0", "hardware": { broken json', 'utf-8');
      let malformedCaught = false;
      try {
        loadOasisConfig(tempDir);
      } catch (err) {
        malformedCaught = err instanceof OasisConfigError && err.name === 'OasisConfigError';
      }
      recordResult('Config Corruption', 'Malformed JSON throws OasisConfigError', malformedCaught);

      // 4.3 Base valid config helper
      const baseValid = createDefaultOasisConfig({ cwd: tempDir, preset: 'duo' });

      // 4.4 Invalid hardware tier rejection
      const invalidTierConfig = JSON.parse(JSON.stringify(baseValid));
      invalidTierConfig.hardware.tier = 'quantum_mega_tier';
      fs.writeFileSync(configPath, JSON.stringify(invalidTierConfig, null, 2), 'utf-8');
      let invalidTierCaught = false;
      let invalidTierMsg = '';
      try {
        loadOasisConfig(tempDir);
      } catch (err) {
        invalidTierCaught = err instanceof OasisConfigError;
        invalidTierMsg = err.message;
      }
      recordResult(
        'Config Corruption',
        'Invalid hardware tier rejected with OasisConfigError',
        invalidTierCaught && invalidTierMsg.includes('Invalid "hardware.tier"'),
        invalidTierMsg
      );

      // 4.5 Remote host rejection (Sovereign OpSec violation)
      const remoteHosts = [
        'api.openai.com',
        '192.168.1.100',
        '0.0.0.0',
        '8.8.8.8',
        '10.0.0.5',
        'ollama.internal.corporate.lan',
      ];
      let allRemoteRejected = true;
      for (const host of remoteHosts) {
        const remoteConfig = JSON.parse(JSON.stringify(baseValid));
        remoteConfig.ollama.host = host;
        fs.writeFileSync(configPath, JSON.stringify(remoteConfig, null, 2), 'utf-8');
        try {
          loadOasisConfig(tempDir);
          allRemoteRejected = false;
          console.log(`    Failed to reject remote host: ${host}`);
        } catch (err) {
          if (!(err instanceof OasisConfigError) || !err.message.includes('OpSec violation')) {
            allRemoteRejected = false;
            console.log(`    Unexpected error for ${host}: ${err.message}`);
          }
        }
      }
      recordResult(
        'OpSec Enforcement',
        'Remote / non-loopback hosts rejected (api.openai.com, 192.168.x.x, 0.0.0.0, 8.8.8.8)',
        allRemoteRejected
      );

      // 4.6 Injected Cloud API Credentials (OpSec violation)
      const credentialPayloads = [
        { apiKey: 'sk-proj-1234567890abcdef' },
        { OPENAI_API_KEY: 'sk-live-secret-key-123' },
        { anthropic_api_key: 'sk-ant-admin-999' },
        { nested: { subKey: 'my_secret_apikey_here' } },
      ];
      let allCredentialsRejected = true;
      for (const cred of credentialPayloads) {
        const injectedConfig = Object.assign(JSON.parse(JSON.stringify(baseValid)), cred);
        fs.writeFileSync(configPath, JSON.stringify(injectedConfig, null, 2), 'utf-8');
        try {
          loadOasisConfig(tempDir);
          allCredentialsRejected = false;
          console.log(`    Failed to reject credential payload: ${JSON.stringify(cred)}`);
        } catch (err) {
          if (!(err instanceof OasisConfigError) || !err.message.includes('OpSec violation: Cloud API credentials')) {
            allCredentialsRejected = false;
            console.log(`    Unexpected error for credential injection: ${err.message}`);
          }
        }
      }
      recordResult(
        'OpSec Enforcement',
        'Injected cloud API keys (sk-..., apiKey, api_key) rejected with OpSec violation',
        allCredentialsRejected
      );

      // 4.7 Missing required sections (hardware, model, team, ollama)
      const requiredSections = ['hardware', 'model', 'ollama', 'team'];
      let allSectionsEnforced = true;
      for (const sec of requiredSections) {
        const trimmedConfig = JSON.parse(JSON.stringify(baseValid));
        delete trimmedConfig[sec];
        fs.writeFileSync(configPath, JSON.stringify(trimmedConfig, null, 2), 'utf-8');
        try {
          loadOasisConfig(tempDir);
          allSectionsEnforced = false;
        } catch (err) {
          if (!(err instanceof OasisConfigError) || !err.message.includes(`Missing "${sec}"`)) {
            allSectionsEnforced = false;
          }
        }
      }
      recordResult('Config Corruption', 'Missing sections (hardware, model, ollama, team) rejected with OasisConfigError', allSectionsEnforced);

      // 4.8 Invalid port boundaries (< 1 or > 65535)
      const invalidPorts = [-1, 0, 65536, 99999];
      let allPortsRejected = true;
      for (const p of invalidPorts) {
        const portConfig = JSON.parse(JSON.stringify(baseValid));
        portConfig.ollama.port = p;
        fs.writeFileSync(configPath, JSON.stringify(portConfig, null, 2), 'utf-8');
        try {
          loadOasisConfig(tempDir);
          allPortsRejected = false;
        } catch (err) {
          if (!(err instanceof OasisConfigError) || !err.message.includes('Invalid "ollama.port"')) {
            allPortsRejected = false;
          }
        }
      }
      recordResult('Config Corruption', 'Invalid ollama port boundaries (< 1 or > 65535) rejected', allPortsRejected);

      // 4.9 Direct assertLoopbackHost tests
      const validLoopbacks = [
        '127.0.0.1',
        '127.0.0.2',
        '127.255.255.254',
        'localhost',
        '::1',
        '[::1]',
        'http://127.0.0.1:11434',
        'http://localhost:11434',
      ];
      let validLoopbacksPass = true;
      for (const host of validLoopbacks) {
        try {
          assertLoopbackHost(host);
        } catch (err) {
          validLoopbacksPass = false;
          console.log(`    Valid loopback unexpectedly threw: ${host} -> ${err.message}`);
        }
      }
      recordResult('OpSec Unit', 'assertLoopbackHost accepts valid loopbacks (127.x.x.x, localhost, ::1)', validLoopbacksPass);

      const invalidLoopbacks = [
        '192.168.1.1',
        '10.0.0.1',
        '0.0.0.0',
        'api.groq.com',
        'http://external.site.com:11434',
      ];
      let invalidLoopbacksFail = true;
      for (const host of invalidLoopbacks) {
        try {
          assertLoopbackHost(host);
          invalidLoopbacksFail = false;
          console.log(`    Invalid loopback failed to throw: ${host}`);
        } catch (err) {
          if (!(err instanceof OasisOpSecError)) {
            invalidLoopbacksFail = false;
          }
        }
      }
      recordResult('OpSec Unit', 'assertLoopbackHost rejects non-loopbacks with OasisOpSecError', invalidLoopbacksFail);

      // 4.10 saveOasisConfig guard: throws without writing corrupt data
      let saveGuardPassed = false;
      try {
        const corruptConfig = JSON.parse(JSON.stringify(baseValid));
        corruptConfig.hardware.tier = 'non_existent_tier';
        saveOasisConfig(corruptConfig, tempDir);
      } catch (err) {
        saveGuardPassed = err instanceof OasisConfigError;
      }
      recordResult('Save Guard', 'saveOasisConfig validates before writing to prevent disk corruption', saveGuardPassed);

      // 4.11 Adversarial isLoopbackHost boundary inputs
      const loopbackEdgeCases = [
        { host: '127.0.0.1', expected: true },
        { host: '127.100.200.1', expected: true },
        { host: '127.255.255.255', expected: true },
        { host: 'localhost', expected: true },
        { host: 'LOCALHOST', expected: true },
        { host: '::1', expected: true },
        { host: '[::1]', expected: true },
        { host: '0:0:0:0:0:0:0:1', expected: true },
        { host: '127.0.0.1.evil.com', expected: false },
        { host: 'localhost.evil.com', expected: false },
        { host: '0.0.0.0', expected: false },
        { host: '192.168.1.1', expected: false },
        { host: '10.0.0.1', expected: false },
        { host: '172.16.0.1', expected: false },
        { host: '8.8.8.8', expected: false },
        { host: '', expected: false },
        { host: null, expected: false },
        { host: undefined, expected: false },
      ];
      const allLoopbackEdgesPass = loopbackEdgeCases.every(
        (c) => isLoopbackHost(c.host) === c.expected
      );
      recordResult(
        'OpSec Adversarial',
        'isLoopbackHost accurately handles 18 adversarial loopback boundary cases',
        allLoopbackEdgesPass
      );

      // 4.12 Adversarial validateOasisConfig edge cases (null, primitives, empty object)
      const nonObjectCases = [null, undefined, '', 123, true, {}];
      const allNonObjectsRejected = nonObjectCases.every((v) => !validateOasisConfig(v).valid);
      recordResult(
        'Schema Adversarial',
        'validateOasisConfig rejects null, primitives, and empty objects',
        allNonObjectsRejected
      );

      // 4.13 isMaosInitialized detects oasis config without .maos/ directory
      const { isMaosInitialized } = require(path.resolve(__dirname, '../dist/utils/paths.js'));
      const emptyCheck = isMaosInitialized(tempDir); // initially empty or has corrupt
      // write valid oasis config
      fs.writeFileSync(configPath, JSON.stringify(baseValid, null, 2), 'utf-8');
      const oasisInitializedCheck = isMaosInitialized(tempDir);
      recordResult(
        'Core Integration',
        'isMaosInitialized returns true when maos-oasis.config.json is present (zero .maos dependency)',
        oasisInitializedCheck === true
      );
    } finally {
      cleanTempDir(tempDir);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUITE 5: Doctor Diagnostics & Auto-Repair (--fix)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 5: Doctor Diagnostics & Auto-Repair ---');
  {
    const tempDir = makeTempDir('oasis-doctor-');
    try {
      // 5.1 Doctor in uninitialized directory reports failure and exits with code 1
      const uninitDoctorRes = child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'doctor', '--json'],
        { cwd: tempDir, encoding: 'utf-8', timeout: 15000 }
      );
      const uninitFailed = uninitDoctorRes.status === 1;
      let uninitJson = null;
      try {
        uninitJson = JSON.parse(uninitDoctorRes.stdout);
      } catch {}
      const uninitReportedNotReady = uninitJson && uninitJson.readiness === 'not_ready' && uninitJson.passed === false;
      recordResult(
        'Doctor Diagnostics',
        'Doctor in uninitialized directory returns exit code 1 and readiness "not_ready"',
        uninitFailed && uninitReportedNotReady,
        `Exit code: ${uninitDoctorRes.status}, readiness: ${uninitJson?.readiness}`
      );

      // 5.2 Initialize valid workplace
      child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'init', '--yes', '--non-interactive', '--preset', 'duo', '--skip-pull'],
        { cwd: tempDir, encoding: 'utf-8', timeout: 25000 }
      );

      // 5.3 Break a runtime directory (delete .maos-oasis/queue)
      const queueDir = path.join(tempDir, '.maos-oasis', 'queue');
      fs.rmSync(queueDir, { recursive: true, force: true });
      assert.strictEqual(fs.existsSync(queueDir), false);

      // 5.4 Run doctor --json (without fix) -> should report warn/missing folders
      const brokenDocRes = child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'doctor', '--json'],
        { cwd: tempDir, encoding: 'utf-8', timeout: 15000 }
      );
      let brokenJson = null;
      try {
        brokenJson = JSON.parse(brokenDocRes.stdout);
      } catch {}
      const configCheckWarned = brokenJson && brokenJson.checks?.some((c) => c.id === 'oasis_config' && c.status === 'warn');
      recordResult('Doctor Diagnostics', 'Missing runtime subdirectory reported as warning with fix hint', Boolean(configCheckWarned));

      // 5.5 Run doctor --fix -> should auto-repair missing directory!
      const fixDocRes = child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'doctor', '--fix', '--json'],
        { cwd: tempDir, encoding: 'utf-8', timeout: 15000 }
      );
      const queueRestored = fs.existsSync(queueDir) && fs.existsSync(path.join(queueDir, 'pending'));
      let fixJson = null;
      try {
        fixJson = JSON.parse(fixDocRes.stdout);
      } catch {}
      const configCheckPassed = fixJson && fixJson.checks?.some((c) => c.id === 'oasis_config' && c.status === 'pass');
      recordResult(
        'Doctor Auto-Repair',
        'doctor --fix automatically restores deleted runtime queue directories',
        Boolean(queueRestored && configCheckPassed),
        `queueRestored: ${queueRestored}, configCheckStatus: ${configCheckPassed}`
      );

      // 5.6 Test doctor with OpSec violation in config
      const configPath = path.join(tempDir, 'maos-oasis.config.json');
      const validConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      validConfig.ollama.host = 'api.anthropic.com';
      fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2), 'utf-8');

      // 5.6a Direct unit test of checkLoopbackOpSec with remote host
      const directOpSecCheck = checkLoopbackOpSec(validConfig);
      const directOpSecFailed = directOpSecCheck.status === 'fail' && directOpSecCheck.message.includes('OpSec Violation');
      recordResult(
        'Doctor OpSec Diagnostics',
        'checkLoopbackOpSec returns fail status for remote host endpoint',
        directOpSecFailed,
        directOpSecCheck.message
      );

      // 5.6b CLI invocation of doctor with OpSec-violating config
      const opsecDocRes = child_process.spawnSync(
        process.execPath,
        [CLI_BIN, 'doctor', '--json'],
        { cwd: tempDir, encoding: 'utf-8', timeout: 15000 }
      );
      const opsecExitCode = opsecDocRes.status === 1;
      const stderrHasOpSec = opsecDocRes.stderr.includes('OpSec violation: "ollama.host" must be loopback');
      recordResult(
        'Doctor OpSec Diagnostics',
        'Doctor CLI rejects remote host in config with exit code 1 and OpSec error on stderr',
        Boolean(opsecExitCode && stderrHasOpSec),
        `Exit code: ${opsecDocRes.status}, stderr: ${opsecDocRes.stderr.trim()}`
      );
    } finally {
      cleanTempDir(tempDir);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
