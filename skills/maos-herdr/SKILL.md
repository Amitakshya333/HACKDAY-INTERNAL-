---
name: maos-herdr
description: Operate MAOS-Gemma autonomous worker panes via the Herdr terminal multiplexer with the OpenCode plus local Gemma harness. Use when tiling panes, dispatching isolated worktree agents, running parallel builds and tests, or healing red failures for the maos ignite workflow.
license: MIT
allowed-tools: read_file write_file list_dir run_command search_code git_commit share_knowledge request_from_team respond_to_team task_complete
metadata:
  version: 1.0.0
  track: hackday-2026-open-innovation
  harness: opencode
  models: gemma2-2b gemma2-9b qwen2.5-coder-7b
  endpoint: http://localhost:11434
---

# MAOS-Herdr Multi-Pane Autonomous Agent Skill

## Overview

MAOS-Gemma is a sovereign multi-pane terminal swarm kernel.
One goal command drives it:

```bash
maos ignite --gemma --harness herdr --goal "<any task>"
```

Roles:

- **MAOS** is the orchestrator. It owns the task DAG, git worktrees, branch isolation, and telemetry.
- **Herdr** is the terminal multiplexer. It owns physical panes, processes, and scrollback buffers.
- **OpenCode** is the model harness. It gives the local model AST parsing, LSP navigation, file editing, file diffing, and bash tool execution.
- **Gemma / Qwen** is the intelligence. Local models at `http://localhost:11434` do the reasoning and patch generation. Gemma is primary. Qwen 2.5 Coder is the fallback.

This skill tells a worker agent how to behave inside its Herdr pane.

## When To Use This Skill

Use this skill when the agent must:

- Run inside an isolated Herdr pane and git worktree.
- Decompose a goal into atomic non-conflicting subtasks.
- Write code, run builds, and execute test suites concurrently with other panes.
- Read terminal scrollback over Herdr IPC and hot-inject repair patches.
- Merge only after tests pass.

Do not use this skill for single-shot cloud chat, for editing outside the assigned scope, or for any task that requires pushing to a remote.

## Preconditions

1. Assigned worktree only. Work under the pane's worktree path, for example `C:\HACKDAY WINNER\worktrees\<feature>`.
2. Assigned branch only. Never commit to `main` from a worker pane.
3. Local models only. Endpoints must be loopback: `127.0.0.1`, `localhost`, or `::1`. Default Ollama endpoint is `http://localhost:11434/v1`.
4. Scoped file access. Modify only files in the task `scope` list.
5. Zero remote pushes. Never run `git push origin`. All commits stay local until the orchestrator merges.

## Workflow

### 1. Ground

1. Call `list_dir` on the worktree root and `read_file` on entry points before any edit.
2. Call `search_code` for existing patterns covering the task.
3. Call `share_knowledge` with type `FILE_MAP` when the layout is non-obvious.

### 2. Plan Small

1. Break the goal into file-scoped patches.
2. One pane owns one worktree and one branch. Do not edit files owned by another pane.
3. If blocked on another pane, call `request_from_team` with `urgency: blocking` and continue with independent work.

### 3. Implement With OpenCode Discipline

1. State the diff intent first: file, lines, behavior change.
2. Call `write_file` with complete content. No `TODO`, no placeholders.
3. Re-read the file after writing when the edit is structural.
4. Run verification with `run_command` from the project root:
   - `npx tsc --noEmit`
   - Targeted test file, then the broader suite.
5. On red output, diagnose from the scrollback, patch, and re-run until green.

### 4. Commit Locally

1. Call `git_commit` with a conventional message, for example `feat: add herdr pane split driver`.
2. Stay on the feature branch. Never merge to `main` from a worker.
3. Call `task_complete` with a summary and `files_changed` list.

### 5. Heal On Failure

When tests or builds fail:

1. Capture the failing section from the Herdr pane buffer.
2. Extract the stack trace, failing file, and exact error line.
3. Apply the minimal repair patch.
4. Re-run the failing command before any other work.
5. Repeat until green or the iteration budget forces a partial commit plus `task_complete`.

## Herdr Pane Operations

The orchestrator owns pane lifecycle through the Herdr IPC driver at `src/integrations/herdr.ts`. Workers do not split panes themselves. Workers must:

- Treat pane output as the source of truth for process state.
- Assume the pane may be observed at any time. Keep commands deterministic and output readable.
- Never kill sibling panes or close the tab.
- Emit progress through the standard tool loop so the message bus records heartbeats.

Reference commands owned by the orchestrator:

- `herdr pane split` for tiling.
- `herdr pane run` for launching a worker.
- `herdr pane read` for scrollback capture.
- `herdr agent prompt` for inter-agent messaging.

## OpenCode Plus Gemma Harness

The provider at `src/backends/opencode-gemma-provider.ts` wraps local models with OpenCode discipline:

- Primary: `gemma2:9b` at roughly 5.2 GB VRAM for reasoning and codegen.
- Fast triage: `gemma2:2b` or `gemma3:4b` for decomposition.
- Fallback: `qwen2.5-coder:7b` when Gemma output is weak on code.
- Endpoint: `http://localhost:11434/v1` via Ollama, or llama.cpp on `http://localhost:8080/v1`.
- CLI fallback: `opencode run -f <prompt-file> --model <tag>` when HTTP is unavailable.

Every model call is augmented with the harness addendum: read first, state diffs, verify with commands, keep edits scoped, prefer small patches.

## Safety And OpSec Constraints

1. Loopback only. Reject any non-loopback base URL.
2. Scope enforcement. Out-of-scope writes are rejected.
3. No secrets in prompts, diffs, or commits.
4. No network exfiltration. All model and socket traffic stays on localhost.
5. No remote git operations. No `push`, no `pull` from cloud remotes during the sprint.
6. Clean local history. Keep commits atomic so the orchestrator can squash or preserve them for the submission window.

## Examples

### Example 1: Implement a scoped backend file

1. `read_file` on `src/backends/provider.ts` and `src/backends/openai-provider.ts`.
2. `write_file` the new provider with full `IProvider` coverage.
3. `run_command` with `npx tsc --noEmit`.
4. `git_commit`, then `task_complete`.

### Example 2: Heal a red test from scrollback

1. Read the Herdr buffer showing `FAIL tests/herdr.test.ts`.
2. Extract the assertion and the offending line.
3. Patch the source file.
4. Re-run the single test file, then the suite.
5. Commit on green.

## Verification Checklist

- [ ] Worked only inside the assigned worktree and branch.
- [ ] Used loopback endpoints exclusively.
- [ ] Read before writing; verified after writing.
- [ ] Tests or typechecks pass, or failure is reported as partial with evidence.
- [ ] Local commit created; no remote push performed.
- [ ] `task_complete` called with an accurate summary.
