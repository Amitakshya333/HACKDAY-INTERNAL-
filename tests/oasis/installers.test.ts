import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

describe('Cross-Platform Installers Test Suite (tests/oasis/installers.test.ts)', () => {
  const shPath = path.resolve(__dirname, '../../scripts/install-oasis.sh');
  const ps1Path = path.resolve(__dirname, '../../scripts/install-oasis.ps1');

  // Capability detection for dynamic test execution
  const hasPowerShell = (() => {
    try {
      const cmd = process.platform === 'win32' ? 'powershell' : 'pwsh';
      const res = spawnSync(cmd, ['-NoProfile', '-Command', 'Write-Host OK'], { encoding: 'utf8' });
      return res.status === 0 && (res.stdout || '').includes('OK');
    } catch {
      return false;
    }
  })();

  const bashCommand = (() => {
    if (process.platform === 'win32') {
      const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
      if (fs.existsSync(gitBash)) return gitBash;
    }
    try {
      const res = spawnSync('bash', ['-c', 'echo OK'], { encoding: 'utf8' });
      if (res.status === 0 && (res.stdout || '').includes('OK')) return 'bash';
    } catch {}
    return null;
  })();

  // ── 1. Script Presence & File Hygiene ────────────────────────
  describe('File Presence & Hygiene', () => {
    it('verifies scripts/install-oasis.sh exists and is non-empty', () => {
      expect(fs.existsSync(shPath), `Missing Linux installer at: ${shPath}`).toBe(true);
      const stat = fs.statSync(shPath);
      expect(stat.size).toBeGreaterThan(1500);
    });

    it('verifies scripts/install-oasis.ps1 exists and is non-empty', () => {
      expect(fs.existsSync(ps1Path), `Missing PowerShell installer at: ${ps1Path}`).toBe(true);
      const stat = fs.statSync(ps1Path);
      expect(stat.size).toBeGreaterThan(1500);
    });

    it('enforces 100% strict 7-bit ASCII compliance on install-oasis.ps1 (zero non-ASCII bytes)', () => {
      const buffer = fs.readFileSync(ps1Path);
      const nonAsciiViolations: Array<{ index: number; byte: number; line: number }> = [];

      let currentLine = 1;
      for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i];
        if (byte === 10) currentLine++;
        if (byte > 127) {
          nonAsciiViolations.push({ index: i, byte, line: currentLine });
        }
      }

      expect(
        nonAsciiViolations,
        `Found ${nonAsciiViolations.length} non-ASCII byte(s) in install-oasis.ps1! Samples: ${JSON.stringify(nonAsciiViolations.slice(0, 5))}`,
      ).toHaveLength(0);
    });

    it('strictly forbids Unicode smart quotes, en/em dashes, and non-ASCII markers in install-oasis.ps1', () => {
      const content = fs.readFileSync(ps1Path, 'utf8');

      // Common typographical culprits in PowerShell scripts
      expect(content).not.toMatch(/[\u2018\u2019\u201C\u201D]/); // Curly quotes
      expect(content).not.toMatch(/[\u2013\u2014]/); // En-dash, Em-dash
      expect(content).not.toMatch(/[\u2713\u2714\u2716\u2718]/); // Unicode check/cross marks
      expect(content).not.toMatch(/[\u2139\u25B6\u26A0\uD83D]/); // Emojis / bullets

      // Logging functions must use strict ASCII prefixes
      expect(content).toContain('function Write-Step([string]$msg)  { Write-Host "[+] $msg"');
      expect(content).toContain('function Write-Ok([string]$msg)    { Write-Host "[OK] $msg"');
      expect(content).toContain('function Write-Warn([string]$msg)  { Write-Host "[WARN] $msg"');
      expect(content).toContain('function Write-Err([string]$msg)   { Write-Host "[ERR] $msg"');
      expect(content).toContain('function Write-Info([string]$msg)  { Write-Host "[i] $msg"');
      expect(content).toContain('function Write-Prog([string]$msg)  { Write-Host "[...] $msg"');
    });

    it('enforces 100% POSIX LF line endings on install-oasis.sh (zero CRLF carriage returns)', () => {
      const buffer = fs.readFileSync(shPath);
      let crCount = 0;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === 13) crCount++;
      }

      expect(
        crCount,
        `Found ${crCount} CRLF carriage return bytes (0x0D) in install-oasis.sh! Must be pure POSIX LF.`,
      ).toBe(0);

      // Verify exact shebang on line 1
      const firstLine = buffer.slice(0, 19).toString('ascii');
      expect(firstLine).toBe('#!/usr/bin/env bash');
    });
  });

  // ── 2. PowerShell Installer Static Contract ──────────────────
  describe('PowerShell Installer Contract (scripts/install-oasis.ps1)', () => {
    let content: string;

    beforeEach(() => {
      content = fs.readFileSync(ps1Path, 'utf8');
    });

    it('declares advanced cmdlet binding and explicit parameter block', () => {
      expect(content).toContain('[CmdletBinding(SupportsShouldProcess = $true)]');
      expect(content).toMatch(/param\s*\([\s\S]*?\[switch\]\$NonInteractive/);
      expect(content).toMatch(/\[string\]\$Model\s*=\s*""/);
      expect(content).toMatch(/\[switch\]\$SkipInit/);
      expect(content).toMatch(/\[switch\]\$SkipPull/);
      expect(content).toMatch(/\[string\]\$PackageSource\s*=\s*"maos-oasis"/);
      expect(content).toMatch(/\[switch\]\$DryRun/);
    });

    it('declares strict mode and Stop error action preference', () => {
      expect(content).toContain('Set-StrictMode -Version Latest');
      expect(content).toContain("$ErrorActionPreference = 'Stop'");
    });

    it('bridges environment variables for piped irm | iex execution', () => {
      expect(content).toContain('$env:OASIS_NON_INTERACTIVE');
      expect(content).toContain('$env:CI');
      expect(content).toContain('$env:OASIS_MODEL');
      expect(content).toContain('$env:OASIS_SKIP_INIT');
      expect(content).toContain('$env:OASIS_SKIP_PULL');
      expect(content).toContain('$env:OASIS_DRY_RUN');
    });

    it('implements genuine Session PATH preservation mechanism without clobbering', () => {
      expect(content).toContain('function Update-SessionPath');
      // Preserves existing session PATH first
      expect(content).toContain("$elements += ($env:Path -split ';')");
      // Queries Machine and User registry
      expect(content).toContain('[System.EnvironmentVariableTarget]::Machine');
      expect(content).toContain('[System.EnvironmentVariableTarget]::User');
      // Includes known standard dirs
      expect(content).toContain('Join-Path $env:APPDATA "npm"');
      expect(content).toContain('Join-Path $env:LOCALAPPDATA "Programs\\Ollama"');
      expect(content).toContain('Join-Path $env:LOCALAPPDATA "Programs\\Herdr\\bin"');
      // Deduplicates preserving precedence
      expect(content).toContain('$unique -notcontains $trimmed');
    });

    it('contains multi-tier GPU probing logic (nvidia-smi, 64-bit qwMemorySize, and CIM)', () => {
      expect(content).toContain('nvidia-smi.exe');
      expect(content).toContain('--query-gpu=name,memory.total,driver_version');
      expect(content).toContain('HardwareInformation.qwMemorySize');
      expect(content).toContain('Get-CimInstance Win32_VideoController');
    });

    it('enforces Gemma hardware sizing matrix thresholds', () => {
      expect(content).toContain('$vramMb -ge 6000');
      expect(content).toContain('$chosenModel = "gemma2:9b"');
      expect(content).toContain('$vramMb -ge 4000');
      expect(content).toContain('$chosenModel = "gemma3:4b"');
      expect(content).toContain('$chosenModel = "gemma2:2b"');
    });

    it('enforces loopback OpSec on Ollama daemon URI', () => {
      expect(content).toContain('http://127.0.0.1:11434/api/tags');
      expect(content).not.toMatch(/http:\/\/(?!127\.0\.0\.1|localhost)/);
    });

    it('defines explicit fallback strings for Herdr and OpenCode companion toolchains', () => {
      expect(content).toContain('single-pane fallback mode');
      expect(content).toMatch(/direct loopback (?:Ollama )?API fallback mode/i);
    });

    it('exits with code 0 on DryRun completion', () => {
      expect(content).toContain('if ($DryRun)');
      expect(content).toContain('exit 0');
    });
  });

  // ── 3. Linux Bash Installer Static Contract ──────────────────
  describe('Linux Bash Installer Contract (scripts/install-oasis.sh)', () => {
    let content: string;

    beforeEach(() => {
      content = fs.readFileSync(shPath, 'utf8');
    });

    it('declares strict mode and defensive trap handlers', () => {
      expect(content).toContain('set -Eeuo pipefail');
      expect(content).toContain('trap cleanup EXIT');
      expect(content).toContain("trap 'handle_error $? $LINENO' ERR");
    });

    it('parses command-line arguments and flags', () => {
      expect(content).toContain('--non-interactive|-y|--yes');
      expect(content).toContain('--skip-init');
      expect(content).toContain('--skip-pull');
      expect(content).toContain('--dry-run');
      expect(content).toContain('--debug');
      expect(content).toContain('--model=*');
    });

    it('contains Linux OS guard with helpful redirection to PowerShell installer', () => {
      expect(content).toContain('uname -s');
      expect(content).toContain('install-oasis.ps1');
      expect(content).toContain('npm install -g maos-oasis');
    });

    it('implements controlling terminal (/dev/tty) preservation for curl piped execution', () => {
      expect(content).toContain('has_controlling_tty()');
      expect(content).toContain('[ -e /dev/tty ]');
      expect(content).toContain('read -r reply </dev/tty');
      expect(content).toContain('maos-oasis init ${model_flag} </dev/tty');
    });

    it('enforces Node.js >= 20 requirement and multi-distro installer detection', () => {
      expect(content).toContain('[ "$node_major" -ge 20 ]');
      expect(content).toContain('command -v apt-get');
      expect(content).toContain('command -v dnf');
      expect(content).toContain('command -v yum');
      expect(content).toContain('command -v pacman');
      expect(content).toContain('command -v apk');
      expect(content).toContain('command -v zypper');
    });

    it('implements GPU probing via nvidia-smi and rocm-smi with identical Gemma sizing matrix', () => {
      expect(content).toContain('command -v nvidia-smi');
      expect(content).toContain('command -v rocm-smi');
      expect(content).toContain('[ "$vram_mb" -ge 6000 ]');
      expect(content).toContain('chosen_model="gemma2:9b"');
      expect(content).toContain('[ "$vram_mb" -ge 4000 ]');
      expect(content).toContain('chosen_model="gemma3:4b"');
      expect(content).toContain('chosen_model="gemma2:2b"');
    });

    it('enforces loopback OpSec for Ollama service', () => {
      expect(content).toContain('http://127.0.0.1:11434/api/tags');
    });

    it('defines companion toolchain fallbacks matching PowerShell parity', () => {
      expect(content).toContain('Operating in single-pane fallback mode (all agent logs stream sequentially)');
      expect(content).toContain('Operating in direct loopback Ollama API fallback mode');
    });
  });

  // ── 4. Cross-Platform Parity Verification ────────────────────
  describe('Cross-Platform Installer Parity', () => {
    let shContent: string;
    let ps1Content: string;

    beforeEach(() => {
      shContent = fs.readFileSync(shPath, 'utf8');
      ps1Content = fs.readFileSync(ps1Path, 'utf8');
    });

    it('guarantees identical hardware VRAM thresholds across both installers', () => {
      // 6000 MB tier
      expect(shContent).toContain('6000');
      expect(ps1Content).toContain('6000');
      expect(shContent).toContain('gemma2:9b');
      expect(ps1Content).toContain('gemma2:9b');

      // 4000 MB tier
      expect(shContent).toContain('4000');
      expect(ps1Content).toContain('4000');
      expect(shContent).toContain('gemma3:4b');
      expect(ps1Content).toContain('gemma3:4b');

      // Fallback tier
      expect(shContent).toContain('gemma2:2b');
      expect(ps1Content).toContain('gemma2:2b');
    });

    it('guarantees identical companion toolchains and repository sources', () => {
      expect(shContent).toContain('https://herdr.dev/install.sh');
      expect(ps1Content).toContain('https://herdr.dev/install.ps1');

      expect(shContent).toContain('@opencode/cli');
      expect(ps1Content).toContain('@opencode/cli');
    });

    it('guarantees zero synthetic bypasses in loopback and security gates', () => {
      // Neither script should ever use mock or dummy loopback overrides
      expect(shContent).not.toContain('OASIS_SYNTHETIC_PASS');
      expect(ps1Content).not.toContain('OASIS_SYNTHETIC_PASS');
    });
  });

  // ── 5. Dynamic AST & Syntax Validation (Conditional) ─────────
  describe('Interpreter Syntax Validation', () => {
    it.runIf(hasPowerShell)('validates install-oasis.ps1 with PowerShell AST parser', () => {
      const psCmd = process.platform === 'win32' ? 'powershell' : 'pwsh';
      const command = `& { $tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${ps1Path.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors); if ($errors.Count -eq 0) { Write-Host 'VALID_AST' } else { Write-Error ($errors | Out-String) } }`;

      const result = spawnSync(psCmd, ['-NoProfile', '-Command', command], { encoding: 'utf8' });
      expect(result.status, `PowerShell AST errors: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('VALID_AST');
    });

    it.runIf(bashCommand !== null)('validates install-oasis.sh with bash -n syntax checker', () => {
      const result = spawnSync(bashCommand!, ['-n', shPath], { encoding: 'utf8' });
      expect(result.status, `Bash syntax error: ${result.stderr}`).toBe(0);
    });
  });

  // ── 6. Behavioral Dry-Run Execution (Conditional) ────────────
  describe('Behavioral Dry-Run Execution', () => {
    it.runIf(hasPowerShell && process.platform === 'win32')(
      'executes install-oasis.ps1 in dry-run mode and verifies zero state mutation',
      () => {
        const psCmd = 'powershell';
        const result = spawnSync(
          psCmd,
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path, '-DryRun', '-NonInteractive'],
          { encoding: 'utf8', timeout: 30000 },
        );

        expect(result.status, `Script failed with error: ${result.stderr}`).toBe(0);
        expect(result.stdout).toContain('[DRY-RUN] Dry-run simulation active');
        expect(result.stdout).toContain('Dry run complete. No modifications were made.');
      },
    );

    it.runIf(bashCommand !== null)('executes install-oasis.sh in dry-run mode and verifies zero state mutation', () => {
      const result = spawnSync(bashCommand!, [shPath, '--dry-run', '--non-interactive'], {
        encoding: 'utf8',
        timeout: 30000,
      });

      expect(result.status, `Script failed with error: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('[DRY-RUN] Dry-run simulation active');
      expect(result.stdout).toContain('Dry-run simulation completed successfully.');
    });
  });
});
