/**
 * MAOS Oasis — Folder Trust & Project Root Resolution (Architecture v4)
 *
 * Enforces per-user trust security:
 *   - Machine-level trust registry stored at `~/.maos-oasis/trusted.json` (never in repo)
 *   - Project root resolution: walks up from current directory to nearest `.maos-oasis/` or `.git/`
 *   - Folder trust verification: prompts user before executing code in untrusted repositories
 *   - Clean exit 0 if user declines folder trust
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import chalk from 'chalk';

export const OASIS_TRUSTED_FILE = 'trusted.json';
export const OASIS_MACHINE_DIR = '.maos-oasis';

export interface TrustedRegistry {
  schemaVersion: number;
  trustedRoots: string[];
  updatedAt?: string;
}

/**
 * Normalizes a directory path for reliable cross-platform comparison.
 */
export function normalizeDirPath(dirPath: string): string {
  let resolved = path.resolve(dirPath);
  try {
    if (fs.existsSync(resolved)) {
      resolved = fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
    }
  } catch {}
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Returns path to machine-wide trust file: `~/.maos-oasis/trusted.json`.
 */
export function getTrustedFilePath(): string {
  return path.join(getMachineDir(), OASIS_TRUSTED_FILE);
}

/**
 * Returns path to machine-wide config directory: `~/.maos-oasis/`.
 */
export function getMachineDir(): string {
  const home = process.env.MAOS_HOME || os.homedir();
  return path.join(home, OASIS_MACHINE_DIR);
}

/**
 * Resolves the project root by walking up from startDir until finding `.maos-oasis/` or `.git/`.
 * If neither is found up to filesystem root, returns the resolved startDir.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  const realHome = normalizeDirPath(os.homedir());
  const envHome = process.env.MAOS_HOME ? normalizeDirPath(process.env.MAOS_HOME) : null;

  while (current) {
    const normCurrent = normalizeDirPath(current);
    // Never treat user home directory as project root (e.g. dotfiles git or machine .maos-oasis)
    if (normCurrent !== realHome && (!envHome || normCurrent !== envHome)) {
      const hasOasis = fs.existsSync(path.join(current, '.maos-oasis'));
      const hasGit = fs.existsSync(path.join(current, '.git'));
      if (hasOasis || hasGit) {
        return current;
      }
    }
    if (current === root) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(startDir);
}

/**
 * Loads list of trusted directory paths from `~/.maos-oasis/trusted.json`.
 */
export function loadTrustedRoots(): string[] {
  const filePath = getTrustedFilePath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as TrustedRegistry;
    if (Array.isArray(parsed?.trustedRoots)) {
      return parsed.trustedRoots;
    }
  } catch {
    // Malformed trust file — fall back to empty list safely
  }
  return [];
}

/**
 * Atomically saves trusted roots list to `~/.maos-oasis/trusted.json`.
 */
export function saveTrustedRoots(roots: string[]): void {
  const machineDir = getMachineDir();
  if (!fs.existsSync(machineDir)) {
    fs.mkdirSync(machineDir, { recursive: true });
  }

  const filePath = getTrustedFilePath();
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  const data: TrustedRegistry = {
    schemaVersion: 1,
    trustedRoots: Array.from(new Set(roots)),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Windows fallback if destination is open or cross-link
    fs.copyFileSync(tmpPath, filePath);
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Checks if a directory is in the machine's trusted roots list.
 */
export function isProjectTrusted(projectRoot: string): boolean {
  const normalizedTarget = normalizeDirPath(projectRoot);
  const trusted = loadTrustedRoots();
  return trusted.some((r) => normalizeDirPath(r) === normalizedTarget);
}

/**
 * Adds a project directory to the machine's trusted roots list.
 */
export function trustProject(projectRoot: string): void {
  const resolved = path.resolve(projectRoot);
  const current = loadTrustedRoots();
  const normalizedTarget = normalizeDirPath(resolved);
  if (!current.some((r) => normalizeDirPath(r) === normalizedTarget)) {
    current.push(resolved);
    saveTrustedRoots(current);
  }
}

/**
 * Revokes trust for a project directory.
 */
export function revokeProjectTrust(projectRoot: string): void {
  const normalizedTarget = normalizeDirPath(projectRoot);
  const current = loadTrustedRoots();
  const filtered = current.filter((r) => normalizeDirPath(r) !== normalizedTarget);
  saveTrustedRoots(filtered);
}

/**
 * Checks folder trust, prompting interactively if untrusted.
 * Returns true if trusted or user approved, false if declined.
 */
export async function checkOrPromptFolderTrust(
  projectRoot: string,
  options?: { nonInteractive?: boolean; yes?: boolean },
): Promise<boolean> {
  const resolvedRoot = path.resolve(projectRoot);

  if (isProjectTrusted(resolvedRoot)) {
    return true;
  }

  if (options?.yes) {
    trustProject(resolvedRoot);
    return true;
  }

  if (options?.nonInteractive) {
    return false;
  }

  // Interactive prompt
  console.log(chalk.bold.yellow('\n⚠️  SECURITY TRUST GATE (Per-User Sovereignty)'));
  console.log(chalk.white(`This folder is not yet trusted by MAOS Oasis on this machine:`));
  console.log(chalk.cyan(`  ${resolvedRoot}\n`));
  console.log(chalk.gray('Agents will read files, execute shell commands, and generate code in this workspace.\n'));

  const answer = await promptYesNo('Do you trust this folder and wish to proceed? (y/N): ');
  if (answer) {
    trustProject(resolvedRoot);
    console.log(chalk.green(`\n✓ Added to trusted folders in ~/.maos-oasis/trusted.json\n`));
    return true;
  }

  return false;
}

/**
 * Simple CLI prompt helper for yes/no question.
 */
function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(chalk.yellow(question), (ans) => {
      rl.close();
      const trimmed = (ans || '').trim().toLowerCase();
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}
