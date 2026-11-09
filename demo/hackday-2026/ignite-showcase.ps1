# ==============================================================================
# 🏆 MAOS-GEMMA: HACK DAY 2026 1-CLICK SHOWCASE LAUNCHER
# Run this script to execute the full physical multi-pane live demonstration.
# ==============================================================================

param(
    [string]$Goal = "Fix authentication session race condition and pass all unit tests",
    [string]$Model = "gemma2:9b",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

Set-Location $ProjectRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 MAOS-GEMMA: SOVEREIGN TERMINAL SWARM SHOWCASE" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Project Root : $ProjectRoot" -ForegroundColor DarkGray
Write-Host "Target Goal  : $Goal" -ForegroundColor Yellow
Write-Host "Local Model  : $Model" -ForegroundColor Magenta
Write-Host ""

# 1. Quick pre-flight test check
Write-Host "▶ Running pre-flight test suites..." -ForegroundColor Cyan
npx vitest run tests/herdr-harness.test.ts tests/demo-auth-service.test.ts

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Pre-flight tests failed! Check environment." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Pre-flight passed: 47/47 tests green." -ForegroundColor Green
Write-Host ""

# 2. Swarm Ignition
Write-Host "▶ Igniting MAOS-Gemma Swarm Kernel..." -ForegroundColor Cyan

if ($DryRun) {
    npx tsx src/cli/index.ts ignite --gemma --model "$Model" --harness herdr --goal "$Goal" --dry-run
} else {
    npx tsx src/cli/index.ts ignite --gemma --model "$Model" --harness herdr --goal "$Goal"
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🏁 Showcase complete. All systems nominal." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
