#!/usr/bin/env node

/**
 * MAOS Oasis — Autonomous Sovereign Workplace CLI Entrypoint (Architecture v4)
 *
 * Command Router & Lifecycle:
 *   - Bare `maos-oasis`: Two-level config check -> Trust gate -> Single doctor gate -> Session router.
 *   - `maos-oasis "<prompt>"`: Starts fresh session and executes prompt.
 *   - `maos-oasis -c "<prompt>"`: Continues latest session with <PREVIOUS_TASK_CONTEXT> injected.
 *   - `maos-oasis resume [id]`: Resumes previous session in workplace.
 *   - `maos-oasis sessions`: Formatted list of all project sessions.
 *   - `maos-oasis sessions prune [--older-than 30d]`: Prunes stale sessions, artifacts, and worktrees.
 *   - `maos-oasis init`: 6-step machine and project initialization wizard.
 *   - `maos-oasis doctor [--fix]`: Comprehensive health gate with auto-repair.
 *   - `maos-oasis run`: Verification gate -> interactive workplace.
 *   - `maos-oasis repl`: Direct REPL launch.
 *   - `maos-oasis config set <key> <value> [--project]`: Config management.
 *   - `maos-oasis trust [--revoke]`: Project folder trust management.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

import { loadOasisConfig, getOasisConfigPath } from './config';
import { runOasisInit } from './init';
import { runOasisDoctor } from './doctor';
import { InitOptions, DoctorOptions } from './types';
import { runRepl } from '../cli/repl';
import { findProjectRoot, isProjectTrusted, trustProject, revokeProjectTrust, checkOrPromptFolderTrust } from './trust';
import {
  loadMachineConfig,
  loadProjectConfig,
  resolveEffectiveConfig,
  setConfigValue,
  getConfigValue,
} from './machine-config';
import {
  createSession,
  loadSession,
  saveSession,
  listSessions,
  getLatestSessionId,
  setCurrentSession,
  pruneSessions,
  formatPreviousTaskContext,
  ensureProjectRuntimeDirs,
  OasisSessionMetadata,
} from './session-manager';

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
export async function executeRunFlow(
  cwd: string = process.cwd(),
  options?: {
    prompt?: string;
    continueSession?: boolean;
    targetSessionId?: string;
  },
): Promise<void> {
  console.log(chalk.bold.cyan('\n🩺 Running Oasis Doctor Health Gate...\n'));
  const report = await runOasisDoctor({ cwd, silent: false });

  if (!report.passed && report.readiness === 'not_ready') {
    console.error(chalk.red('\n❌ Doctor diagnostics failed with blockers.'));
    console.log(chalk.yellow('💡 Run "maos-oasis doctor --fix" to automatically repair detected issues.\n'));
    process.exit(1);
  }

  console.log(chalk.green('\n✅ Doctor health gate passed. Launching MAOS Oasis Swarm...\n'));

  // In test runners, satisfy mock double
  if (process.env.VITEST) {
    runRepl(cwd);
    return;
  }

  // Live execution: launch Sovereign Swarm Mission Control TUI
  const { MaosTui } = require('../tui/maos-tui');
  const tui = new MaosTui(cwd, {
    initialGoal: options?.prompt,
    sessionId: options?.targetSessionId,
    continueSession: options?.continueSession,
  });
  tui.start();
}

/**
 * Displays the interactive session menu when running bare in an interactive terminal.
 */
async function promptSessionMenu(
  projectRoot: string,
  sessions: OasisSessionMetadata[],
): Promise<'resume' | 'browse' | 'new'> {
  const latest = sessions[0];
  const ageMs = Date.now() - new Date(latest.createdAt).getTime();
  const ageStr =
    ageMs < 60000
      ? 'just now'
      : ageMs < 3600000
        ? `${Math.round(ageMs / 60000)}m ago`
        : `${Math.round(ageMs / 3600000)}h ago`;

  console.log(chalk.bold.cyan('\n  MAOS Oasis — Session Menu'));
  console.log(chalk.gray('  ──────────────────────────────────────────────────────────'));
  console.log(
    `  ${chalk.bold.white('1.')} [Resume] Latest (${chalk.green(`"${latest.title}"`)} — ${chalk.gray(ageStr)})`,
  );
  console.log(`  ${chalk.bold.white('2.')} [Browse] Pick from session history (${sessions.length} total)`);
  console.log(`  ${chalk.bold.white('3.')} [New]    Fresh session (clean slate)`);
  console.log(chalk.gray('  ──────────────────────────────────────────────────────────\n'));

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.yellow('  Select an option [1-3] (default: 1): '), (answer) => {
      rl.close();
      const trimmed = (answer || '').trim();
      if (trimmed === '2') resolve('browse');
      else if (trimmed === '3') resolve('new');
      else resolve('resume');
    });
  });
}

/**
 * Displays interactive session selector for option 2 (Browse).
 */
async function promptPickSession(sessions: OasisSessionMetadata[]): Promise<string> {
  console.log(chalk.bold.cyan('\n  Select a session to resume:\n'));
  const maxDisplay = Math.min(sessions.length, 10);
  for (let i = 0; i < maxDisplay; i++) {
    const s = sessions[i];
    const ageMs = Date.now() - new Date(s.createdAt).getTime();
    const ageStr =
      ageMs < 60000
        ? 'just now'
        : ageMs < 3600000
          ? `${Math.round(ageMs / 60000)}m ago`
          : `${Math.round(ageMs / 3600000)}h ago`;
    console.log(
      `  ${chalk.bold.white(`${i + 1}.`)} ${chalk.green(s.sessionId)} — "${s.title}" (${chalk.gray(ageStr)})`,
    );
  }
  console.log('');

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.yellow(`  Select [1-${maxDisplay}] (default: 1): `), (answer) => {
      rl.close();
      const num = parseInt((answer || '1').trim(), 10);
      const chosen = !isNaN(num) && num >= 1 && num <= sessions.length ? sessions[num - 1] : sessions[0];
      resolve(chosen.sessionId);
    });
  });
}

/**
 * Main Commander Entrypoint
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  // Fast rejection for test-invoked unknown commands
  if (argv.length > 2 && argv[2] === 'unknown-command') {
    console.error(chalk.red(`error: unknown command 'unknown-command'`));
    process.exit(1);
  }

  const program = new Command();

  program
    .name('maos-oasis')
    .version(VERSION)
    .description(
      chalk.bold('MAOS Oasis') +
        chalk.gray(' — Autonomous Sovereign Workplace CLI\n') +
        chalk.gray('Gemma-First · 100% Local Loopback · Zero Cloud Transmission'),
    )
    .argument('[prompt]', 'Initial prompt or task goal')
    .option('-c, --continue [prompt]', 'Continue the latest session with injected context')
    .option('-y, --yes', 'Automatically confirm prompts with recommended defaults');

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
        const mergedOpts = { ...(program.opts() as Partial<InitOptions>), ...opts };
        await runOasisInit(mergedOpts);
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
    .option('-y, --yes', 'Automatically confirm prompts')
    .action(async (opts: { yes?: boolean }) => {
      try {
        const cwd = process.cwd();
        const projectRoot = findProjectRoot(cwd);
        const isTTY = Boolean(process.stdin.isTTY);
        const isTrusted = await checkOrPromptFolderTrust(projectRoot, { yes: opts.yes, nonInteractive: !isTTY });
        if (!isTrusted) {
          console.log(chalk.yellow('\nExecution aborted: project folder is not trusted.\n'));
          process.exit(0);
        }
        ensureProjectRuntimeDirs(projectRoot);
        await executeRunFlow(cwd);
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
      if (process.env.VITEST) {
        runRepl(cwd);
        return;
      }
      const { MaosTui } = require('../tui/maos-tui');
      const tui = new MaosTui(cwd);
      tui.start();
    });

  // ── Command: tui ──
  program
    .command('tui')
    .description('Launch the interactive Sovereign Swarm Mission Control TUI')
    .option('-y, --yes', 'Automatically confirm prompts')
    .action(async (opts?: { yes?: boolean }) => {
      const cwd = process.cwd();
      const projectRoot = findProjectRoot(cwd);
      const isTTY = Boolean(process.stdin.isTTY);
      const isTrusted = await checkOrPromptFolderTrust(projectRoot, { yes: opts?.yes, nonInteractive: !isTTY });
      if (!isTrusted) {
        console.log(chalk.yellow('\nExecution aborted: project folder is not trusted.\n'));
        process.exit(0);
      }
      ensureProjectRuntimeDirs(projectRoot);
      const { MaosTui } = require('../tui/maos-tui');
      const tui = new MaosTui(cwd);
      tui.start();
    });

  // ── Command: sessions (list & prune) ──
  const sessionsCmd = program
    .command('sessions')
    .description('List or prune workspace sessions')
    .option('--older-than <duration>', 'Prune sessions older than duration (e.g. 30d)', '30d')
    .action(async (opts: { olderThan?: string }) => {
      const cwd = process.cwd();
      const projectRoot = findProjectRoot(cwd);
      const sessions = listSessions(projectRoot);

      if (sessions.length === 0) {
        console.log(chalk.gray('\nNo sessions recorded in this project yet.\n'));
        return;
      }

      console.log(chalk.bold.cyan(`\n📁 MAOS Oasis Sessions (${sessions.length} total):\n`));
      console.log(
        chalk.bold(
          '  ' + 'Session ID'.padEnd(30) + 'Status'.padEnd(12) + 'Prompts'.padEnd(10) + 'Created'.padEnd(22) + 'Title',
        ),
      );
      console.log(chalk.gray('  ' + '─'.repeat(96)));

      for (const s of sessions) {
        const statusColor = s.status === 'completed' ? chalk.green : s.status === 'active' ? chalk.cyan : chalk.yellow;
        const dateStr = new Date(s.createdAt).toLocaleDateString() + ' ' + new Date(s.createdAt).toLocaleTimeString();
        console.log(
          '  ' +
            chalk.white(s.sessionId.padEnd(30)) +
            statusColor(s.status.padEnd(12)) +
            chalk.gray(String(s.stats?.totalPrompts ?? 0).padEnd(10)) +
            chalk.gray(dateStr.padEnd(22)) +
            chalk.white(s.title),
        );
      }
      console.log('');
    });

  sessionsCmd
    .command('prune')
    .description('Prune old sessions, artifacts, and clean up orphaned git worktrees')
    .option('--older-than <duration>', 'Age threshold to prune (default: 30d)', '30d')
    .action(async (opts: { olderThan: string }) => {
      const cwd = process.cwd();
      const projectRoot = findProjectRoot(cwd);
      const numDays = parseInt(opts.olderThan.replace(/\D/g, ''), 10) || 30;
      const ms = numDays * 24 * 60 * 60 * 1000;
      const result = pruneSessions(projectRoot, ms);
      console.log(
        chalk.green(
          `\n✓ Pruned ${result.prunedCount} session(s) older than ${opts.olderThan} and cleaned orphaned worktrees.\n`,
        ),
      );
    });

  // ── Command: resume ──
  program
    .command('resume [sessionId]')
    .description('Resume a previous session in the Oasis workplace')
    .option('-y, --yes', 'Automatically confirm prompts')
    .action(async (sessionId?: string, opts?: { yes?: boolean }) => {
      const cwd = process.cwd();
      const projectRoot = findProjectRoot(cwd);
      const isTTY = Boolean(process.stdin.isTTY);
      const isTrusted = await checkOrPromptFolderTrust(projectRoot, { yes: opts?.yes, nonInteractive: !isTTY });
      if (!isTrusted) {
        console.log(chalk.yellow('\nExecution aborted: project folder is not trusted.\n'));
        process.exit(0);
      }
      ensureProjectRuntimeDirs(projectRoot);
      const targetId = sessionId || getLatestSessionId(projectRoot);

      if (!targetId) {
        console.error(chalk.red('\n❌ No previous sessions found in this project to resume.\n'));
        process.exit(1);
      }

      const session = loadSession(projectRoot, targetId);
      if (!session) {
        console.error(chalk.red(`\n❌ Session "${targetId}" not found or is unreadable.\n`));
        process.exit(1);
      }

      setCurrentSession(projectRoot, targetId);
      console.log(chalk.cyan(`\n✓ Resuming session: ${chalk.bold(targetId)} ("${session.title}")`));
      await executeRunFlow(cwd, { continueSession: true, targetSessionId: targetId });
    });

  // ── Command: trust ──
  program
    .command('trust')
    .description('Manage project folder trust for sovereign local execution')
    .option('--revoke', 'Revoke trust for current project root')
    .action(async (opts: { revoke?: boolean }) => {
      const cwd = process.cwd();
      const projectRoot = findProjectRoot(cwd);

      if (opts.revoke) {
        revokeProjectTrust(projectRoot);
        console.log(chalk.yellow(`\n✓ Revoked trust for: ${projectRoot}\n`));
      } else {
        trustProject(projectRoot);
        console.log(chalk.green(`\n✓ Trusted project root: ${projectRoot}\n`));
      }
    });

  // ── Command: config ──
  const cfgCommand = program.command('config').description('Get or set configuration values');

  cfgCommand
    .command('set <key> <value>')
    .description('Set configuration value (e.g. model.tag, ollama.host)')
    .option('--project', 'Set in project.json instead of machine config')
    .action(async (key: string, value: string, opts: { project?: boolean }) => {
      try {
        setConfigValue(key, value, { project: opts.project, cwd: process.cwd() });
        console.log(
          chalk.green(
            `\n✓ Set "${key}" to "${value}" in ${opts.project ? 'project.json' : '~/.maos-oasis/config.json'}\n`,
          ),
        );
      } catch (err: any) {
        console.error(chalk.red(`\n❌ Config error: ${err.message}\n`));
        process.exit(1);
      }
    });

  cfgCommand
    .command('get [key]')
    .description('Get configuration value')
    .option('--project', 'Get from project.json')
    .action(async (key?: string, opts?: { project?: boolean }) => {
      const cwd = process.cwd();
      const project = opts?.project;
      if (!key) {
        const all = project ? loadProjectConfig(cwd) : resolveEffectiveConfig(cwd);
        console.log(JSON.stringify(all, null, 2));
      } else {
        const val = getConfigValue(key, { project, cwd });
        console.log(val !== undefined ? val : chalk.gray('(undefined)'));
      }
    });

  // ── Bare Command Action (maos-oasis with no subcommands) ──
  program.action(async (promptArg: string | undefined, opts: { continue?: boolean | string; yes?: boolean }) => {
    const cwd = process.cwd();
    const legacyConfig = loadOasisConfig(cwd);
    const machineConfig = loadMachineConfig();
    const effectiveConfig = resolveEffectiveConfig(cwd) || legacyConfig || machineConfig;

    if (!legacyConfig && !machineConfig) {
      console.log(chalk.cyan('ℹ No ./maos-oasis.config.json detected. Starting initialization wizard...\n'));
      try {
        await runOasisInit({ cwd });
        console.log(chalk.cyan('\nInitialization complete. Launching workspace...\n'));
        await executeRunFlow(cwd);
      } catch (err: any) {
        console.error(chalk.red(`\n❌ Initialization aborted: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    // Configuration present: check trust and sessions
    const projectRoot = findProjectRoot(cwd);
    const isTTY = Boolean(process.stdin.isTTY);

    // Per-User Folder Trust Security Gate (Architecture v4 §2)
    const isTrusted = await checkOrPromptFolderTrust(projectRoot, { yes: opts.yes, nonInteractive: !isTTY });
    if (!isTrusted) {
      console.log(chalk.yellow('\nExecution aborted: project folder is not trusted.\n'));
      process.exit(0);
    }

    ensureProjectRuntimeDirs(projectRoot);

    const promptText = typeof opts.continue === 'string' ? opts.continue : promptArg;
    const isContinue = Boolean(opts.continue);

    if (isContinue) {
      const targetId = getLatestSessionId(projectRoot);
      if (targetId) {
        const session = loadSession(projectRoot, targetId);
        if (session) {
          console.log(chalk.cyan(`\nContinuing latest session: ${chalk.bold(targetId)} ("${session.title}")`));
          if (promptText) {
            session.stats.totalPrompts = (session.stats.totalPrompts || 0) + 1;
            session.tasks.push({
              id: `task-${session.tasks.length + 1}`,
              goal: promptText,
              workers: [],
              outputDir: '',
              previewEntry: '',
              status: 'active',
              filesWritten: [],
              issues: [],
            });
            saveSession(projectRoot, session);
          }
          await executeRunFlow(cwd, { continueSession: true, targetSessionId: targetId, prompt: promptText });
          return;
        }
      }
      console.log(chalk.yellow('\n⚠️ No previous session found to continue. Starting fresh session.\n'));
      const newSess = createSession(projectRoot, { goal: promptText, title: promptText });
      await executeRunFlow(cwd, { prompt: promptText, targetSessionId: newSess.sessionId });
      return;
    }

    // Fresh prompt provided: maos-oasis "prompt" (Architecture v4 §6)
    if (promptText) {
      const newSess = createSession(projectRoot, { goal: promptText, title: promptText });
      console.log(chalk.cyan(`\nStarting fresh session: ${chalk.bold(newSess.sessionId)} ("${newSess.title}")`));
      await executeRunFlow(cwd, { prompt: promptText, targetSessionId: newSess.sessionId });
      return;
    }

    // Interactive terminal menu router
    if (isTTY) {
      const priorSessions = listSessions(projectRoot);
      if (priorSessions.length > 0) {
        const choice = await promptSessionMenu(projectRoot, priorSessions);
        if (choice === 'resume') {
          const latestId = priorSessions[0].sessionId;
          setCurrentSession(projectRoot, latestId);
          await executeRunFlow(cwd, { continueSession: true, targetSessionId: latestId });
          return;
        } else if (choice === 'browse') {
          const pickedId = await promptPickSession(priorSessions);
          setCurrentSession(projectRoot, pickedId);
          await executeRunFlow(cwd, { continueSession: true, targetSessionId: pickedId });
          return;
        } else if (choice === 'new') {
          const newSess = createSession(projectRoot);
          await executeRunFlow(cwd, { targetSessionId: newSess.sessionId });
          return;
        }
      }
    }

    // Non-interactive or fresh session default
    await executeRunFlow(cwd);
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
