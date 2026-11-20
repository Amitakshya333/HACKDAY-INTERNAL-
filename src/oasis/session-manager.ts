/**
 * MAOS Oasis — Session Lifecycle & Context Continuity Manager (Architecture v4)
 *
 * Implements:
 *   - Session on-disk layout (<project-root>/.maos-oasis/sessions/<session-id>/)
 *   - Atomic JSON persistence (*.tmp + rename)
 *   - Lock file guard (sessions/<id>/.lock) to prevent dual-writer race conditions
 *   - <PREVIOUS_TASK_CONTEXT> generator with strict token budgeting
 *   - Session pruning and worktree cleanup
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as child_process from 'child_process';
import { hardenOasisGitignore, ensureOasisRuntimeDirs } from './config';

export type SessionStatus = 'active' | 'completed' | 'failed' | 'abandoned';

export interface OasisSessionTask {
  id: string;
  goal: string;
  workers: string[];
  outputDir: string;
  previewEntry: string;
  status: SessionStatus;
  filesWritten: string[];
  issues: string[];
}

export interface OasisSessionGit {
  baseCommit?: string;
  headCommit?: string;
  branch?: string;
}

export interface OasisSessionStats {
  totalPrompts: number;
  tokensGenerated: number;
  evalDurationMs: number;
}

export interface OasisSessionMetadata {
  schemaVersion: number;
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  model: string;
  git?: OasisSessionGit;
  tasks: OasisSessionTask[];
  stats: OasisSessionStats;
}

export const CURRENT_SESSION_REF = 'current_session.ref';
export const DEFAULT_TOKEN_BUDGET = 1500;

/**
 * Generates unique session identifier matching pattern: sess_YYYYMMDD_HHMMSS_xxxx
 */
export function generateSessionId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const suffix = crypto.randomBytes(2).toString('hex');
  return `sess_${stamp}_${suffix}`;
}

/**
 * Returns path to `.maos-oasis/sessions` inside project root.
 */
export function getSessionsDir(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), '.maos-oasis', 'sessions');
}

/**
 * Ensures project runtime directories (.maos-oasis/sessions, worktrees, logs) exist.
 */
export function ensureProjectRuntimeDirs(projectRoot: string): void {
  const root = path.resolve(projectRoot);
  try {
    ensureOasisRuntimeDirs(root);
  } catch {}
  const dirs = [
    getSessionsDir(root),
    path.join(root, '.maos-oasis', 'worktrees'),
    path.join(root, '.maos-oasis', 'logs'),
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      try {
        fs.mkdirSync(d, { recursive: true });
      } catch {}
    }
  }
  try {
    hardenOasisGitignore(root);
  } catch {}
}

/**
 * Returns path to a specific session directory.
 */
export function getSessionDirPath(projectRoot: string, sessionId: string): string {
  return path.join(getSessionsDir(projectRoot), sessionId);
}

/**
 * Returns path to `.maos-oasis/current_session.ref`.
 */
export function getCurrentSessionRefPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), '.maos-oasis', CURRENT_SESSION_REF);
}

/**
 * Atomically writes data to a file via temporary file replacement.
 */
export function atomicWriteFile(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${targetPath}.tmp.${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  fs.writeFileSync(tmpPath, content, 'utf-8');

  try {
    fs.renameSync(tmpPath, targetPath);
  } catch {
    // Windows fallback if file is locked momentarily
    try {
      fs.copyFileSync(tmpPath, targetPath);
      fs.unlinkSync(tmpPath);
    } catch {
      // Best effort cleanup
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
  }
}

/**
 * Detects current git state (branch, head commit, base commit) if in a git repository.
 */
export function detectGitInfo(projectRoot: string): OasisSessionGit | undefined {
  try {
    const branch = child_process
      .execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      .trim();

    const headCommit = child_process
      .execSync('git rev-parse --short HEAD', {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      .trim();

    return {
      branch: branch || 'main',
      headCommit: headCommit || undefined,
      baseCommit: headCommit || undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Creates a new session directory, writes initial session.json and sets current_session.ref.
 */
export function createSession(
  projectRoot: string,
  options?: {
    title?: string;
    goal?: string;
    model?: string;
  },
): OasisSessionMetadata {
  const sessionId = generateSessionId();
  const sessionDir = getSessionDirPath(projectRoot, sessionId);
  const artifactsDir = path.join(sessionDir, 'artifacts');

  fs.mkdirSync(artifactsDir, { recursive: true });

  const now = new Date().toISOString();
  const title = options?.title || (options?.goal ? options.goal.slice(0, 60) : 'Oasis Session');
  const model = options?.model || 'gemma2:9b';
  const git = detectGitInfo(projectRoot);

  const initialTasks: OasisSessionTask[] = options?.goal
    ? [
        {
          id: 'task-1',
          goal: options.goal,
          workers: [],
          outputDir: '',
          previewEntry: '',
          status: 'active',
          filesWritten: [],
          issues: [],
        },
      ]
    : [];

  const metadata: OasisSessionMetadata = {
    schemaVersion: 1,
    sessionId,
    title,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    model,
    git,
    tasks: initialTasks,
    stats: {
      totalPrompts: options?.goal ? 1 : 0,
      tokensGenerated: 0,
      evalDurationMs: 0,
    },
  };

  const metadataPath = path.join(sessionDir, 'session.json');
  atomicWriteFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');

  // Update current session reference
  setCurrentSession(projectRoot, sessionId);

  return metadata;
}

/**
 * Loads a session's metadata. Skips and warns on corrupted files without crashing.
 */
export function loadSession(projectRoot: string, sessionId: string): OasisSessionMetadata | null {
  const metadataPath = path.join(getSessionDirPath(projectRoot, sessionId), 'session.json');
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(metadataPath, 'utf-8');
    const parsed = JSON.parse(raw) as OasisSessionMetadata;
    if (parsed && parsed.sessionId) {
      return parsed;
    }
  } catch (err: any) {
    console.warn(`[Oasis] Warning: Skipping unreadable session "${sessionId}": ${err.message}`);
  }

  return null;
}

/**
 * Atomically saves updated session metadata to `session.json`.
 */
export function saveSession(projectRoot: string, session: OasisSessionMetadata): void {
  const sessionDir = getSessionDirPath(projectRoot, session.sessionId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  session.updatedAt = new Date().toISOString();
  const metadataPath = path.join(sessionDir, 'session.json');
  atomicWriteFile(metadataPath, JSON.stringify(session, null, 2) + '\n');
}

/**
 * Sets the active session ID in `.maos-oasis/current_session.ref`.
 */
export function setCurrentSession(projectRoot: string, sessionId: string): void {
  const refPath = getCurrentSessionRefPath(projectRoot);
  atomicWriteFile(refPath, sessionId.trim() + '\n');
}

/**
 * Gets the current or latest session ID for the project.
 */
export function getLatestSessionId(projectRoot: string): string | null {
  const refPath = getCurrentSessionRefPath(projectRoot);
  if (fs.existsSync(refPath)) {
    try {
      const id = fs.readFileSync(refPath, 'utf-8').trim();
      if (id && loadSession(projectRoot, id)) {
        return id;
      }
    } catch {}
  }

  // Fallback: list sessions and pick most recent
  const sessions = listSessions(projectRoot);
  return sessions.length > 0 ? sessions[0].sessionId : null;
}

/**
 * Lists all readable sessions sorted descending by creation timestamp.
 */
export function listSessions(projectRoot: string): OasisSessionMetadata[] {
  const sessionsDir = getSessionsDir(projectRoot);
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    const results: OasisSessionMetadata[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('sess_')) {
        const session = loadSession(projectRoot, entry.name);
        if (session) {
          results.push(session);
        }
      }
    }

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return results;
  } catch {
    return [];
  }
}

/**
 * Appends a coordinator event to `transcript.jsonl` in the session folder.
 */
export function appendSessionTranscript(projectRoot: string, sessionId: string, entry: Record<string, unknown>): void {
  const sessionDir = getSessionDirPath(projectRoot, sessionId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFileSync(path.join(sessionDir, 'transcript.jsonl'), line, 'utf-8');
}

/**
 * Writes or updates `context_summary.md` for a session during compaction.
 */
export function compactSessionContext(projectRoot: string, sessionId: string, summaryMarkdown: string): void {
  const sessionDir = getSessionDirPath(projectRoot, sessionId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const summaryPath = path.join(sessionDir, 'context_summary.md');
  atomicWriteFile(summaryPath, summaryMarkdown.trim() + '\n');
}

/**
 * Formats `<PREVIOUS_TASK_CONTEXT>` for injecting prior session context when continuing.
 * Adheres to token budget and trimming order:
 *   Current request -> open issues -> files written -> summary
 */
export function formatPreviousTaskContext(
  session: OasisSessionMetadata,
  projectRoot: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
): string {
  const lastTask = session.tasks.length > 0 ? session.tasks[session.tasks.length - 1] : undefined;
  const goal = lastTask?.goal || session.title;
  const outputDir = lastTask?.outputDir || 'output/';
  const previewEntry = lastTask?.previewEntry || `${outputDir}/index.html`;

  const filesWritten = lastTask?.filesWritten || [];
  const filesList = filesWritten.length > 0 ? filesWritten.map((f) => `  - ${f}`).join('\n') : '  - (none recorded)';

  const issues = lastTask?.issues || [];
  const issuesList = issues.length > 0 ? issues.map((i) => `  - ${i}`).join('\n') : '  - None';

  // Read context_summary.md if present
  let summaryText = 'None';
  const summaryPath = path.join(getSessionDirPath(projectRoot, session.sessionId), 'context_summary.md');
  if (fs.existsSync(summaryPath)) {
    try {
      summaryText = fs.readFileSync(summaryPath, 'utf-8').trim();
    } catch {}
  }

  // Estimate char budget (~4 chars per token)
  const maxChars = tokenBudget * 4;
  let summaryBudget = maxChars - 600; // Reserve room for header and file lists
  if (summaryBudget < 200) summaryBudget = 200;

  if (summaryText.length > summaryBudget) {
    summaryText = summaryText.slice(0, summaryBudget) + '... [truncated]';
  }

  return [
    '<PREVIOUS_TASK_CONTEXT>',
    `Session: ${session.sessionId} ("${session.title}")`,
    `Last goal: "${goal}"`,
    `Output directory: ${outputDir}   (preview entry: ${previewEntry})`,
    'Files written last turn:',
    filesList,
    'Open issues:',
    issuesList,
    'Summary of earlier turns:',
    `  ${summaryText.replace(/\n/g, '\n  ')}`,
    '</PREVIOUS_TASK_CONTEXT>',
  ].join('\n');
}

/**
 * Acquires session concurrency lock. Returns release function.
 */
export function acquireSessionLock(projectRoot: string, sessionId: string): { acquired: boolean; release: () => void } {
  const sessionDir = getSessionDirPath(projectRoot, sessionId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const lockPath = path.join(sessionDir, '.lock');

  const tryClaim = (): boolean => {
    try {
      // Atomic exclusive creation: fails with EEXIST if file already exists
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx', encoding: 'utf-8' });
      return true;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') {
        return false;
      }
      // Lock file already exists — check if holding process is alive
      try {
        const pidStr = fs.readFileSync(lockPath, 'utf-8').trim();
        const pid = parseInt(pidStr, 10);
        if (pid && !isNaN(pid)) {
          try {
            process.kill(pid, 0); // throws if process is dead
            return false; // holding process is still alive
          } catch {
            // Process is dead: stale lock, safe to remove and retry
            try {
              fs.unlinkSync(lockPath);
              fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx', encoding: 'utf-8' });
              return true;
            } catch {
              return false;
            }
          }
        }
      } catch {
        return false;
      }
      return false;
    }
  };

  if (!tryClaim()) {
    return { acquired: false, release: () => {} };
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (fs.existsSync(lockPath)) {
        const content = fs.readFileSync(lockPath, 'utf-8').trim();
        if (content === String(process.pid)) {
          fs.unlinkSync(lockPath);
        }
      }
    } catch {}
  };

  process.once('exit', release);
  return { acquired: true, release };
}

/**
 * Prunes sessions older than specified age (default 30 days) and runs git worktree prune.
 */
export function pruneSessions(
  projectRoot: string,
  olderThanMs: number = 30 * 24 * 60 * 60 * 1000,
): { prunedCount: number; prunedIds: string[] } {
  const sessions = listSessions(projectRoot);
  const cutoff = Date.now() - olderThanMs;
  const prunedIds: string[] = [];

  for (const sess of sessions) {
    const createdTime = new Date(sess.createdAt).getTime();
    if (createdTime < cutoff) {
      const dir = getSessionDirPath(projectRoot, sess.sessionId);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        prunedIds.push(sess.sessionId);
      } catch (err: any) {
        console.warn(`[Oasis] Could not remove pruned session directory ${dir}: ${err.message}`);
      }
    }
  }

  // If current session was pruned, reset ref to the next available session
  const currentRef = getLatestSessionId(projectRoot);
  if (currentRef && prunedIds.includes(currentRef)) {
    const remaining = listSessions(projectRoot);
    if (remaining.length > 0) {
      setCurrentSession(projectRoot, remaining[0].sessionId);
    } else {
      const refPath = getCurrentSessionRefPath(projectRoot);
      if (fs.existsSync(refPath)) {
        try {
          fs.unlinkSync(refPath);
        } catch {}
      }
    }
  }

  // Prune git worktrees if repository
  try {
    child_process.execSync('git worktree prune', {
      cwd: projectRoot,
      stdio: 'ignore',
      timeout: 5000,
    });
  } catch {}

  return { prunedCount: prunedIds.length, prunedIds };
}
