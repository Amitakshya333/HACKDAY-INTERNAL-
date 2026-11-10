#!/usr/bin/env node

/**
 * MAOS Oasis — Autonomous Sovereign Workplace CLI Entrypoint
 *
 * Command Router:
 *   - Bare `maos-oasis`: Checks ./maos-oasis.config.json.
 *     If missing -> executes `init`.
 *     If present -> executes `doctor` -> if doctor passes, launches REPL.
 *   - `maos-oasis init`: Runs 6-step interactive onboarding wizard.
 *   - `maos-oasis doctor`: Runs 6-point diagnostics with --fix auto-repair.
 *   - `maos-oasis run`: Executes doctor verification gate and launches REPL.
 *   - `maos-oasis repl`: Directly launches the interactive Oasis REPL.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';

import { loadOasisConfig, getOasisConfigPath } from './config';
import { runOasisInit } from './init';
import { runOasisDoctor } from './doctor';
import { InitOptions, DoctorOptions } from './types';
import { runRepl } from '../cli/repl';

const VERSION = '0.4.0';

/**
 * Global unhandled error handlers for graceful CLI exits.
 */
process.on('uncaughtException', (err: Error) => {
  console.error(chalk.red(`\n❌ Unexpected Oasis error: ${err.message}`));
  if (process.env.MAOS_DEBUG) {
    console.error(chalk.gray(err.stack || ''));
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(chalk.red(`\n❌ Unhandled rejection: ${msg}`));
  process.exit(1);
});

/**
 * Runs the doctor health gate; upon success, launches the interactive REPL.
 */
export async function executeRunFlow(cwd: string = process.cwd()): Promise<void> {
  console.log(chalk.bold.cyan('\n🩺 Running Oasis Doctor Health Gate...\n'));
  const report = await runOasisDoctor({ cwd, silent: false });

  if (!report.passed && report.readiness === 'not_ready') {
    console.error(chalk.red('\n❌ Doctor diagnostics failed with blockers.'));
    console.log(chalk.yellow('💡 Run "maos-oasis doctor --fix" to automatically repair detected issues.\n'));
    process.exit(1);
  }

  console.log(chalk.green('\n✅ Doctor health gate passed. Launching MAOS Oasis REPL...\n'));
  runRepl(cwd);
}

/**
 * Main Commander Entrypoint
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name('maos-oasis')
    .version(VERSION)
    .description(
      chalk.bold('MAOS Oasis') +
        chalk.gray(' — Autonomous Sovereign Workplace CLI\n') +
        chalk.gray('Gemma-First · 100% Local Loopback · Zero Cloud Transmission'),
    );

  // ── Command: init ──
  program
    .command('init')
    .description('Initialize MAOS Oasis sovereign workplace in current directory')
    .option('-y, --yes', 'Automatically confirm prompts with recommended defaults')
    .option('-m, --model <model>', 'Specify primary Gemma model tag')
    .option('-p, --preset <preset>', 'Specify team preset (solo, duo, team)')
    .option('--non-interactive', 'Run without interactive prompts')
    .option('--skip-pull', 'Skip model pulling step')
    .option('-f, --force', 'Force overwrite existing configuration')
    .action(async (opts: InitOptions) => {
      try {
        await runOasisInit(opts);
      } catch (err: any) {
        console.error(chalk.red(`\n❌ Initialization error: ${err.message}`));
        process.exit(1);
      }
    });

  // ── Command: doctor ──
  program
    .command('doctor')
    .alias('doc')
    .description('Run 6-point diagnostics for loopback, Ollama, Gemma, and companion toolchains')
    .option('--fix', 'Automatically repair runtime directories, start Ollama, or pull model')
    .option('--json', 'Output diagnostics report as JSON')
    .action(async (opts: DoctorOptions) => {
      try {
        const report = await runOasisDoctor(opts);
        if (!report.passed && report.readiness === 'not_ready') {
          process.exit(1);
        }
      } catch (err: any) {
        console.error(chalk.red(`\n❌ Doctor error: ${err.message}`));
        process.exit(1);
      }
    });

  // ── Command: run ──
  program
    .command('run')
    .description('Execute doctor verification gate and launch interactive REPL')
    .action(async () => {
      try {
        await executeRunFlow(process.cwd());
      } catch (err: any) {
        console.error(chalk.red(`\n❌ Run error: ${err.message}`));
        process.exit(1);
      }
    });

  // ── Command: repl ──
  program
    .command('repl')
    .description('Directly launch the interactive MAOS Oasis REPL')
    .action(async () => {
      const cwd = process.cwd();
      const config = loadOasisConfig(cwd);
      if (!config) {
        console.error(chalk.red('❌ MAOS Oasis is not initialized. Run `maos-oasis init` first.'));
        process.exit(1);
      }
      runRepl(cwd);
    });

  // ── Bare Command Action (maos-oasis with no subcommands) ──
  program.action(async () => {
    const cwd = process.cwd();
    const config = loadOasisConfig(cwd);

    if (!config) {
      console.log(chalk.cyan('ℹ No ./maos-oasis.config.json detected. Starting initialization wizard...\n'));
      try {
        await runOasisInit({ cwd });
        console.log(chalk.cyan('\nInitialization complete. Launching workspace...\n'));
        await executeRunFlow(cwd);
      } catch (err: any) {
        console.error(chalk.red(`\n❌ Initialization aborted: ${err.message}`));
        process.exit(1);
      }
    } else {
      // Configuration present -> execute run flow (doctor -> repl)
      await executeRunFlow(cwd);
    }
  });

  await program.parseAsync(argv);
}

// Auto-run if executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error(chalk.red(`Fatal error: ${err.message}`));
    process.exit(1);
  });
}
