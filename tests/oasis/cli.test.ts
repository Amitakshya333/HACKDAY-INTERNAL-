import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// ── Hoisted Mock Declarations ─────────────────────────────────
const mocks = vi.hoisted(() => ({
  loadOasisConfig: vi.fn(),
  getOasisConfigPath: vi.fn((cwd: string = process.cwd()) => path.join(cwd, 'maos-oasis.config.json')),
  runOasisInit: vi.fn(),
  runOasisDoctor: vi.fn(),
  runRepl: vi.fn(),
}));

vi.mock('../../src/oasis/config', () => ({
  loadOasisConfig: mocks.loadOasisConfig,
  getOasisConfigPath: mocks.getOasisConfigPath,
}));

vi.mock('../../src/oasis/init', () => ({
  runOasisInit: mocks.runOasisInit,
}));

vi.mock('../../src/oasis/doctor', () => ({
  runOasisDoctor: mocks.runOasisDoctor,
}));

vi.mock('../../src/cli/repl', () => ({
  runRepl: mocks.runRepl,
}));

// Import CLI entrypoint after hoisted mocks are installed
import { main, executeRunFlow } from '../../src/oasis/oasis-cli';
import { MaosOasisConfig, DoctorReport } from '../../src/oasis/types';

describe('MAOS Oasis CLI Entrypoint (tests/oasis/cli.test.ts)', () => {
  let exitCalls: (string | number | null | undefined)[] = [];
  let stdoutBuffer: string[] = [];
  let stderrBuffer: string[] = [];
  let consoleLogBuffer: string[] = [];
  let consoleErrorBuffer: string[] = [];

  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const defaultMockConfig: MaosOasisConfig = {
    version: '1.0.0',
    oasisRoot: process.cwd(),
    hardware: { gpu: 'RTX 4060', vramMB: 8188, tier: 'high' },
    model: { primary: 'gemma2:9b', fallback: 'gemma2:2b', tag: 'gemma2:9b', contextTokens: 8192 },
    ollama: { host: '127.0.0.1', port: 11434, autoStart: true },
    dependencies: {
      herdr: { available: true, multiPaneEnabled: true },
      opencode: { available: true, harnessEnabled: true },
    },
    team: {
      preset: 'solo',
      leadModel: 'gemma2:9b',
      workerModel: 'gemma2:9b',
      reviewerModel: 'gemma2:9b',
    },
  };

  const passingDoctorReport: DoctorReport = {
    passed: true,
    exitCode: 0,
    readiness: 'ready',
    summary: { passed: 6, failed: 0, warned: 0 },
    checks: [],
    durationMs: 42,
  };

  const blockingDoctorReport: DoctorReport = {
    passed: false,
    exitCode: 1,
    readiness: 'not_ready',
    summary: { passed: 4, failed: 2, warned: 0 },
    checks: [{ id: 'ollama_daemon', name: 'Ollama Daemon', status: 'fail', message: 'Daemon offline', required: true }],
    durationMs: 50,
  };

  const warningDoctorReport: DoctorReport = {
    passed: false,
    exitCode: 0,
    readiness: 'degraded_ready',
    summary: { passed: 5, failed: 0, warned: 1 },
    checks: [{ id: 'toolchain_herdr', name: 'Herdr', status: 'warn', message: 'Herdr missing', required: false }],
    durationMs: 35,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    exitCalls = [];
    stdoutBuffer = [];
    stderrBuffer = [];
    consoleLogBuffer = [];
    consoleErrorBuffer = [];

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
      exitCalls.push(code);
      throw new Error(`process.exit: ${code}`);
    });

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str: any) => {
      stdoutBuffer.push(String(str));
      return true;
    });

    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((str: any) => {
      stderrBuffer.push(String(str));
      return true;
    });

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      consoleLogBuffer.push(args.map(String).join(' '));
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      consoleErrorBuffer.push(args.map(String).join(' '));
    });

    // Default mock behavior
    mocks.loadOasisConfig.mockReturnValue(defaultMockConfig);
    mocks.runOasisInit.mockResolvedValue(defaultMockConfig);
    mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);
    mocks.runRepl.mockReturnValue(undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ── 1. executeRunFlow Unit Tests ─────────────────────────────
  describe('executeRunFlow', () => {
    it('runs doctor health gate and launches REPL when report is ready', async () => {
      mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);

      await executeRunFlow('/test/workspace');

      expect(mocks.runOasisDoctor).toHaveBeenCalledWith({ cwd: '/test/workspace', silent: false });
      expect(mocks.runRepl).toHaveBeenCalledWith('/test/workspace');
      expect(exitCalls).toHaveLength(0);
      expect(consoleLogBuffer.some((msg) => msg.includes('Doctor health gate passed'))).toBe(true);
    });

    it('launches REPL even when doctor reports warnings if readiness is not_ready is false', async () => {
      mocks.runOasisDoctor.mockResolvedValue(warningDoctorReport);

      await executeRunFlow('/test/workspace');

      expect(mocks.runRepl).toHaveBeenCalledWith('/test/workspace');
      expect(exitCalls).toHaveLength(0);
    });

    it('blocks REPL launch and calls process.exit(1) when doctor report readiness is not_ready', async () => {
      mocks.runOasisDoctor.mockResolvedValue(blockingDoctorReport);

      await expect(executeRunFlow('/test/workspace')).rejects.toThrow('process.exit: 1');

      expect(mocks.runRepl).not.toHaveBeenCalled();
      expect(exitCalls).toContain(1);
      expect(consoleErrorBuffer.some((msg) => msg.includes('Doctor diagnostics failed with blockers'))).toBe(true);
      expect(consoleLogBuffer.some((msg) => msg.includes('maos-oasis doctor --fix'))).toBe(true);
    });

    it('uses process.cwd() as default cwd parameter', async () => {
      mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);

      await executeRunFlow();

      expect(mocks.runOasisDoctor).toHaveBeenCalledWith({ cwd: process.cwd(), silent: false });
      expect(mocks.runRepl).toHaveBeenCalledWith(process.cwd());
    });
  });

  // ── 2. Bare Command Routing (maos-oasis with no args) ────────
  describe('Bare command execution (`maos-oasis`)', () => {
    it('auto-routes to init wizard when configuration file is missing', async () => {
      mocks.loadOasisConfig.mockReturnValue(null);
      mocks.runOasisInit.mockResolvedValue(defaultMockConfig);
      mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);

      await main(['node', 'maos-oasis']);

      expect(mocks.loadOasisConfig).toHaveBeenCalledWith(process.cwd());
      expect(consoleLogBuffer.some((msg) => msg.includes('No ./maos-oasis.config.json detected'))).toBe(true);
      expect(mocks.runOasisInit).toHaveBeenCalledWith({ cwd: process.cwd() });
      expect(consoleLogBuffer.some((msg) => msg.includes('Initialization complete. Launching workspace'))).toBe(true);
      expect(mocks.runOasisDoctor).toHaveBeenCalledWith({ cwd: process.cwd(), silent: false });
      expect(mocks.runRepl).toHaveBeenCalledWith(process.cwd());
      expect(exitCalls).toHaveLength(0);
    });

    it('exits with code 1 if initialization wizard fails or is aborted', async () => {
      mocks.loadOasisConfig.mockReturnValue(null);
      mocks.runOasisInit.mockRejectedValue(new Error('User aborted trust gate'));

      await expect(main(['node', 'maos-oasis'])).rejects.toThrow('process.exit: 1');

      expect(mocks.runOasisInit).toHaveBeenCalled();
      expect(mocks.runOasisDoctor).not.toHaveBeenCalled();
      expect(mocks.runRepl).not.toHaveBeenCalled();
      expect(exitCalls).toContain(1);
      expect(consoleErrorBuffer.some((msg) => msg.includes('Initialization aborted: User aborted trust gate'))).toBe(
        true,
      );
    });

    it('directly executes run flow (doctor -> repl) when configuration is already present', async () => {
      mocks.loadOasisConfig.mockReturnValue(defaultMockConfig);
      mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);

      await main(['node', 'maos-oasis']);

      expect(mocks.loadOasisConfig).toHaveBeenCalledWith(process.cwd());
      expect(mocks.runOasisInit).not.toHaveBeenCalled();
      expect(mocks.runOasisDoctor).toHaveBeenCalledWith({ cwd: process.cwd(), silent: false });
      expect(mocks.runRepl).toHaveBeenCalledWith(process.cwd());
      expect(exitCalls).toHaveLength(0);
    });

    it('terminates with code 1 if doctor diagnostics fail during bare run flow', async () => {
      mocks.loadOasisConfig.mockReturnValue(defaultMockConfig);
      mocks.runOasisDoctor.mockResolvedValue(blockingDoctorReport);

      await expect(main(['node', 'maos-oasis'])).rejects.toThrow('process.exit: 1');

      expect(mocks.runOasisDoctor).toHaveBeenCalled();
      expect(mocks.runRepl).not.toHaveBeenCalled();
      expect(exitCalls).toContain(1);
    });
  });

  // ── 3. Subcommand: init ──────────────────────────────────────
  describe('Subcommand `init`', () => {
    it('dispatches to runOasisInit with default flags', async () => {
      await main(['node', 'maos-oasis', 'init']);

      expect(mocks.runOasisInit).toHaveBeenCalledTimes(1);
      expect(exitCalls).toHaveLength(0);
    });

    it('parses and passes all CLI options to runOasisInit', async () => {
      await main([
        'node',
        'maos-oasis',
        'init',
        '-y',
        '-m',
        'gemma2:9b',
        '-p',
        'team',
        '--non-interactive',
        '--skip-pull',
        '-f',
      ]);

      expect(mocks.runOasisInit).toHaveBeenCalledWith(
        expect.objectContaining({
          yes: true,
          model: 'gemma2:9b',
          preset: 'team',
          nonInteractive: true,
          skipPull: true,
          force: true,
        }),
      );
    });

    it('handles long option flags (--yes, --force, --model, --preset)', async () => {
      await main(['node', 'maos-oasis', 'init', '--yes', '--force', '--model', 'gemma4:e4b', '--preset', 'duo']);

      expect(mocks.runOasisInit).toHaveBeenCalledWith(
        expect.objectContaining({
          yes: true,
          force: true,
          model: 'gemma4:e4b',
          preset: 'duo',
        }),
      );
    });

    it('catches thrown error in runOasisInit, logs red error, and exits with code 1', async () => {
      mocks.runOasisInit.mockRejectedValue(new Error('Directory write permission denied'));

      await expect(main(['node', 'maos-oasis', 'init'])).rejects.toThrow('process.exit: 1');

      expect(exitCalls).toContain(1);
      expect(
        consoleErrorBuffer.some((msg) => msg.includes('Initialization error: Directory write permission denied')),
      ).toBe(true);
    });
  });

  // ── 4. Subcommand: doctor (and alias doc) ────────────────────
  describe('Subcommand `doctor` / `doc`', () => {
    it('dispatches to runOasisDoctor with default options', async () => {
      mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);

      await main(['node', 'maos-oasis', 'doctor']);

      expect(mocks.runOasisDoctor).toHaveBeenCalledWith(expect.any(Object));
      expect(exitCalls).toHaveLength(0);
    });

    it('supports alias `doc`', async () => {
      mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);

      await main(['node', 'maos-oasis', 'doc']);

      expect(mocks.runOasisDoctor).toHaveBeenCalledTimes(1);
      expect(exitCalls).toHaveLength(0);
    });

    it('passes --fix and --json flags to runOasisDoctor', async () => {
      mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);

      await main(['node', 'maos-oasis', 'doctor', '--fix', '--json']);

      expect(mocks.runOasisDoctor).toHaveBeenCalledWith(
        expect.objectContaining({
          fix: true,
          json: true,
        }),
      );
    });

    it('exits with code 1 when doctor report readiness is not_ready', async () => {
      mocks.runOasisDoctor.mockResolvedValue(blockingDoctorReport);

      await expect(main(['node', 'maos-oasis', 'doctor'])).rejects.toThrow('process.exit: 1');

      expect(exitCalls).toContain(1);
    });

    it('does not exit with 1 when doctor report passes with degraded readiness', async () => {
      mocks.runOasisDoctor.mockResolvedValue(warningDoctorReport);

      await main(['node', 'maos-oasis', 'doctor']);

      expect(exitCalls).toHaveLength(0);
    });

    it('catches thrown error in runOasisDoctor, logs red error, and exits with code 1', async () => {
      mocks.runOasisDoctor.mockRejectedValue(new Error('Ollama loopback socket timeout'));

      await expect(main(['node', 'maos-oasis', 'doctor'])).rejects.toThrow('process.exit: 1');

      expect(exitCalls).toContain(1);
      expect(consoleErrorBuffer.some((msg) => msg.includes('Doctor error: Ollama loopback socket timeout'))).toBe(true);
    });
  });

  // ── 5. Subcommand: run ───────────────────────────────────────
  describe('Subcommand `run`', () => {
    it('executes run flow gate and launches REPL upon passing doctor report', async () => {
      mocks.runOasisDoctor.mockResolvedValue(passingDoctorReport);

      await main(['node', 'maos-oasis', 'run']);

      expect(mocks.runOasisDoctor).toHaveBeenCalled();
      expect(mocks.runRepl).toHaveBeenCalledWith(process.cwd());
      expect(exitCalls).toHaveLength(0);
    });

    it('exits with code 1 when executeRunFlow throws or doctor reports blocker', async () => {
      mocks.runOasisDoctor.mockResolvedValue(blockingDoctorReport);

      await expect(main(['node', 'maos-oasis', 'run'])).rejects.toThrow('process.exit: 1');

      expect(mocks.runRepl).not.toHaveBeenCalled();
      expect(exitCalls).toContain(1);
    });
  });

  // ── 6. Subcommand: repl ──────────────────────────────────────
  describe('Subcommand `repl`', () => {
    it('aborts and exits with code 1 if workspace is uninitialized', async () => {
      mocks.loadOasisConfig.mockReturnValue(null);

      await expect(main(['node', 'maos-oasis', 'repl'])).rejects.toThrow('process.exit: 1');

      expect(mocks.runRepl).not.toHaveBeenCalled();
      expect(exitCalls).toContain(1);
      expect(
        consoleErrorBuffer.some((msg) => msg.includes('MAOS Oasis is not initialized. Run `maos-oasis init` first.')),
      ).toBe(true);
    });

    it('launches REPL directly if configuration is valid', async () => {
      mocks.loadOasisConfig.mockReturnValue(defaultMockConfig);

      await main(['node', 'maos-oasis', 'repl']);

      expect(mocks.runRepl).toHaveBeenCalledWith(process.cwd());
      expect(exitCalls).toHaveLength(0);
    });
  });

  // ── 7. Global CLI Flags & Error Handling ─────────────────────
  describe('Global flags & Commander built-ins', () => {
    it('outputs version string 0.4.0 on --version / -V and exits with code 0', async () => {
      await expect(main(['node', 'maos-oasis', '--version'])).rejects.toThrow('process.exit: 0');

      expect(exitCalls).toContain(0);
      expect(stdoutBuffer.some((out) => out.includes('0.4.0'))).toBe(true);
    });

    it('outputs help text containing program name, subcommands, and description on --help', async () => {
      await expect(main(['node', 'maos-oasis', '--help'])).rejects.toThrow('process.exit: 0');

      expect(exitCalls).toContain(0);
      const combinedOutput = stdoutBuffer.join('\n');
      expect(combinedOutput).toContain('maos-oasis');
      expect(combinedOutput).toContain('init');
      expect(combinedOutput).toContain('doctor');
      expect(combinedOutput).toContain('run');
      expect(combinedOutput).toContain('repl');
      expect(combinedOutput).toContain('Gemma-First');
      expect(combinedOutput).toContain('Zero Cloud Transmission');
    });

    it('exits with code 1 on unknown subcommand or option', async () => {
      await expect(main(['node', 'maos-oasis', 'unknown-command'])).rejects.toThrow('process.exit: 1');
      expect(exitCalls).toContain(1);
    });

    it('exits with code 1 on invalid option flag', async () => {
      await expect(main(['node', 'maos-oasis', '--invalid-flag'])).rejects.toThrow('process.exit: 1');
      expect(exitCalls).toContain(1);
    });
  });

  // ── 8. Global Unhandled Handlers ─────────────────────────────
  describe('Unhandled exception & rejection handlers', () => {
    it('handles uncaughtException by printing error and invoking process.exit(1)', () => {
      const listeners = process.listeners('uncaughtException') as Array<(err: Error) => void>;
      expect(listeners.length).toBeGreaterThan(0);
      const oasisHandler = listeners[listeners.length - 1];

      expect(() => oasisHandler(new Error('Catastrophic failure'))).toThrow('process.exit: 1');
      expect(exitCalls).toContain(1);
      expect(consoleErrorBuffer.some((msg) => msg.includes('Unexpected Oasis error: Catastrophic failure'))).toBe(true);
    });

    it('handles unhandledRejection by printing error and invoking process.exit(1)', () => {
      const listeners = process.listeners('unhandledRejection') as Array<(reason: unknown) => void>;
      expect(listeners.length).toBeGreaterThan(0);
      const oasisHandler = listeners[listeners.length - 1];

      expect(() => oasisHandler(new Error('Promise rejected'))).toThrow('process.exit: 1');
      expect(exitCalls).toContain(1);
      expect(consoleErrorBuffer.some((msg) => msg.includes('Unhandled rejection: Promise rejected'))).toBe(true);
    });

    it('handles unhandledRejection with non-Error primitive reason', () => {
      const listeners = process.listeners('unhandledRejection') as Array<(reason: unknown) => void>;
      const oasisHandler = listeners[listeners.length - 1];

      expect(() => oasisHandler('String error reason')).toThrow('process.exit: 1');
      expect(exitCalls).toContain(1);
      expect(consoleErrorBuffer.some((msg) => msg.includes('Unhandled rejection: String error reason'))).toBe(true);
    });
  });
});
