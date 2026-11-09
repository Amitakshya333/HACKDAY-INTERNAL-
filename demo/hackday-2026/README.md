# 🏆 Hack Day 2026: MAOS-Gemma Live Demonstration Guide

### *The Sovereign Multi-Pane Terminal Swarm Kernel*
> **Run end-to-end multi-agent coding swarms with zero cloud API dependencies.**

---

## ⚡ The 90-Second Live Pitch & Demo Script

### 1. The Challenge (0:00 - 0:20)
* *"Judges, modern AI coding tools are trapped in single-threaded chat boxes. When you work on critical, air-gapped infrastructure, cloud AI is completely unavailable. MAOS-Gemma turns local open-weight models into a living, physical terminal multi-agent operating system."*

### 2. The Ignition (0:20 - 0:45)
Run the unified swarm command:
```bash
maos ignite --gemma --harness herdr --goal "Fix authentication session race condition and pass all unit tests"
```
**What the judges see:**
* The terminal dynamically splits into live, synchronized Herdr panes.
* Local Gemma (running on an RTX 4060 with 8GB VRAM via the OpenCode model harness) decomposes the task graph.
* Worker agents checkout isolated Git worktrees and start compiling and testing in parallel.

### 3. The Closed-Loop Self-Healing Climax (0:45 - 1:15)
* In Pane 3, a unit test fails with a red stack trace (`AssertionError: Session token expired unexpectedly`).
* **Hands off the keyboard!**
* The Autonomous Healer intercepts the raw scrollback buffer from Herdr's IPC socket.
* Gemma analyzes the stack trace, identifies the timestamp drift bug in `auth-service.ts`, and hot-injects a targeted patch into the worker pane.
* The test suite automatically re-runs: **Tests pass (GREEN)**.

### 4. Consensus & Merge (1:15 - 1:30)
* MAOS reconciles the isolated worktrees, generates the cryptographic audit log, and cleanly merges the branch.

---

## 🛠️ Target Test Fixture
- Source: `demo/hackday-2026/src/auth-service.ts`
- Test: `demo/hackday-2026/tests/auth-service.test.ts`
- Run local test: `npx vitest run demo/hackday-2026/tests/auth-service.test.ts`
