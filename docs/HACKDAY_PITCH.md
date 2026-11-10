# 🏆 MAOS Oasis: Hack Day 2026 Pitch Deck & Script
### *The Sovereign Multi-Pane Terminal Swarm Kernel*
> **Tracks Hit:** Open Innovation Track (Best Use of Gemma & Best Open-Source AI Project) + Software Track (Resilient Engineering)

---

##  Slide 1: The Problem — The "Single-Threaded Trap"
* **The Reality of AI Coding Today:**
  * Every existing coding assistant (Claude Code, GitHub Copilot, Cursor) is **single-threaded** and trapped inside a single chat window.
  * Developers wait in serial for one model to finish typing before they can test, inspect diffs, or run linters.
  * In air-gapped, sovereign, or emergency infrastructure (defense, banks, disaster zones), **cloud AI is completely dead**.
* **The Question:** *What if an air-gapped, open-weight model could physically multiplex your terminal and orchestrate a living swarm of developer agents in parallel?*

---

## Slide 2: The Solution — MAOS Oasis
* **MAOS Core:** The orchestration brain — decomposes arbitrary tasks into non-conflicting dependency DAGs and isolated Git worktrees.
* **Gemma Intelligence:** The sovereign on-device brain (fits comfortably in 8GB VRAM on an RTX 4060) acting as the spec architect and root-cause diagnostician.
* **OpenCode Harness:** The execution home for Gemma — providing AST parsing, file diffing, and tool execution.
* **Herdr Multi-Pane Action Harness:** Programmatically owns the physical terminal panes over local IPC sockets (`herdr.sock`), multiplexing live agent sessions side-by-side.
* **Closed-Loop Autonomous Healer:** Intercepts red terminal scrollback buffers, parses stack traces, and hot-injects self-repair patches with zero human keystrokes.

---

## Slide 3: Live 90-Second Demo (The Climax)

```text
+------------------------------------+------------------------------------+
| PANE 1: MAOS Oasis Swarm Kernel    | PANE 2: Gemma Coder (Worktree)     |
| [IGNITE] Decomposing goal into     | Checking out git branch...         |
| atomic parallel worktree tasks     | Writing auth-service passkey logic |
+------------------------------------+------------------------------------+
| PANE 3: Live Fuzzing & Tests       | PANE 4: Autonomous Healer          |
| ✖ FAIL: Session token expired      | ⚡ Intercepted Red Buffer Trace   |
|   AssertionError at line 42        | Hot-injecting timestamp drift patch|
| Tests re-running... [ALL PASS]     | Consensus verified: MERGE READY   |
+------------------------------------+------------------------------------+
```

1. **Step 1:** Run `./demo/hackday-2026/ignite-showcase.ps1`
2. **Step 2:** Watch the terminal split dynamically into 4 live panes.
3. **Step 3 (Hands off keyboard):** In Pane 3, an intentional test failure appears in RED. The Healer detects it over Herdr's socket, formulates the fix, hotpatches the file, and re-runs tests until they turn GREEN.
4. **Step 4:** Automatic branch merge and cryptographic audit verification.

---

## Slide 4: Why This Wins (Hackathon Alignment)

| Track Requirement | How MAOS Oasis Blows Past It |
| :--- | :--- |
| **Best Use of Gemma** | **Zero API Wrapper:** Runs locally on-device. Takes real physical terminal actions. Ingests raw compiler/terminal output instead of chat text. |
| **Best Open-Source AI Project** | 100% MIT Licensed. Adapts an open-source model harness (OpenCode & Herdr). Introduces a compliant **Agent Skill** (`skills/maos-herdr/SKILL.md`). |
| **Edge Hardware Feasibility** | Runs entirely within 8GB VRAM (NVIDIA RTX 4060) using quantized Gemma 2 2B / 9B. |

---

## Slide 5: The Team & Architecture
* **Orchestration:** TypeScript + MAOS Core (`src/core`, `src/integrations/herdr.ts`)
* **Terminal Engine:** Herdr Socket IPC (`v0.8.0-preview`)
* **Agent Model:** Gemma 2 / Qwen local via OpenCode Harness
* **Test Verification:** 47 automated tests passing in 1.24s
