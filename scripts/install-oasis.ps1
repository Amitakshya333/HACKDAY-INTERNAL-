# ==============================================================================
# MAOS Oasis -- Windows PowerShell Installer Script
#
# One-liner usage:
#   irm https://raw.githubusercontent.com/<org>/maos-oasis/main/scripts/install-oasis.ps1 | iex
#
# Direct file usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-oasis.ps1
#
# Switches & Parameters:
#   -NonInteractive       Run without interactive prompts (for CI/CD or automation)
#   -Model <tag>          Specify Gemma model to pull (e.g. gemma2:9b, gemma2:2b, gemma4:e2b)
#   -SkipInit             Skip launching 'maos-oasis init' after package installation
#   -SkipPull             Skip pulling the Gemma model via Ollama
#   -PackageSource <src>  Override npm package source (default: 'maos-oasis')
#   -DryRun               Inspect and validate system without modifying files or installing
# ==============================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$NonInteractive,
    [string]$Model = "",
    [switch]$SkipInit,
    [switch]$SkipPull,
    [string]$PackageSource = "maos-oasis",
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# -- Environment Variable Synchronization (for piped 'irm | iex' execution) ----
if (($env:OASIS_NON_INTERACTIVE -eq '1') -or ($env:CI -eq 'true') -or ($env:CI -eq '1')) {
    $NonInteractive = $true
}
if ([string]::IsNullOrWhiteSpace($Model) -and (-not [string]::IsNullOrWhiteSpace($env:OASIS_MODEL))) {
    $Model = $env:OASIS_MODEL
}
if ($env:OASIS_SKIP_INIT -eq '1') {
    $SkipInit = $true
}
if ($env:OASIS_SKIP_PULL -eq '1') {
    $SkipPull = $true
}
if ($env:OASIS_DRY_RUN -eq '1') {
    $DryRun = $true
}

# -- ASCII Logging Utilities (Complies strictly with powershell-windows skill) -
function Write-Step([string]$msg)  { Write-Host "[+] $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg)  { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg)   { Write-Host "[ERR] $msg" -ForegroundColor Red }
function Write-Info([string]$msg)  { Write-Host "[i] $msg" -ForegroundColor Gray }
function Write-Prog([string]$msg)  { Write-Host "[...] $msg" -ForegroundColor Cyan }

function Prompt-Confirm([string]$prompt, [bool]$default = $true) {
    if ($NonInteractive) { return $default }
    $suffix = if ($default) { "[Y/n]" } else { "[y/N]" }
    $choice = Read-Host "$prompt $suffix"
    if ([string]::IsNullOrWhiteSpace($choice)) { return $default }
    return ($choice.Trim().ToLower().StartsWith("y"))
}

# -- Session PATH Refresh Mechanism --------------------------------------------
function Update-SessionPath {
    param([switch]$Force)
    try {
        $elements = @()
        # 1. Genuinely preserve existing session PATH entries first (version managers, CI toolcaches, shims)
        if ($env:Path) {
            $elements += ($env:Path -split ';')
        }

        # 2. Query Machine and User registry PATH targets to pick up newly installed tools
        $machinePath = [System.Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::Machine)
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
        if ($machinePath) { $elements += ($machinePath -split ';') }
        if ($userPath) { $elements += ($userPath -split ';') }

        # 3. Include standard user installation directories if they exist on disk
        $npmDir = Join-Path $env:APPDATA "npm"
        $ollamaDir = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
        $herdrDir = Join-Path $env:LOCALAPPDATA "Programs\Herdr\bin"
        $wingetDir = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"

        $knownDirs = @($npmDir, $ollamaDir, $herdrDir, $wingetDir)
        foreach ($dir in $knownDirs) {
            if ((Test-Path $dir) -and ($elements -notcontains $dir)) {
                $elements += $dir
            }
        }

        # 4. Deduplicate entries while strictly preserving precedence (first occurrence wins)
        $unique = @()
        foreach ($p in $elements) {
            $trimmed = $p.Trim().TrimEnd('\')
            if ($trimmed -and ($unique -notcontains $trimmed)) {
                $unique += $trimmed
            }
        }
        $env:Path = ($unique -join ';')
    } catch {
        # Defensive catch: do not clobber existing session PATH on failure
    }
}

# -- Header Banner -------------------------------------------------------------
Write-Host ""
Write-Host "+--------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|  MAOS Oasis -- Sovereign Multi-Agent Coding Swarm      |" -ForegroundColor Cyan
Write-Host "|  Gemma-First . 100% Local Loopback . Zero Cloud        |" -ForegroundColor Cyan
Write-Host "+--------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

if ($DryRun) {
    Write-Ok "[DRY-RUN] Dry-run simulation active -- no system changes will be made."
    Write-Host ""
}

# Ensure session PATH is refreshed from registry at the outset (unless in isolated test)
Update-SessionPath

# -- Stage 1: Node.js & npm Verification ---------------------------------------
Write-Step "Checking Node.js & npm prerequisites..."

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    # Check if newly installed or pending registry broadcast
    Update-SessionPath
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
}

if (-not $nodeCmd) {
    Write-Err "Node.js was not found on PATH. Node.js >= 20.0.0 is required."
    $wingetCmd = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($wingetCmd -and (-not $DryRun) -and (-not $NonInteractive)) {
        if (Prompt-Confirm "Install Node.js 20 LTS now via winget?" $true) {
            Write-Prog "Installing OpenJS.NodeJS.LTS via winget..."
            $wingetPath = $wingetCmd.Source
            & $wingetPath install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
            Update-SessionPath -Force
            $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
        }
    }
}

if (-not $nodeCmd) {
    Write-Err "Node.js >= 20.0.0 is required to run MAOS Oasis."
    Write-Host "Please install Node.js using one of the following methods:"
    Write-Host "  1. winget: winget install OpenJS.NodeJS.LTS"
    Write-Host "  2. fnm:    winget install Schniz.fnm; fnm install 20"
    Write-Host "  3. nvm:    https://github.com/coreybutler/nvm-windows"
    Write-Host "  4. Manual: https://nodejs.org/en/download/"
    exit 1
}

$rawNodeVer = (& $nodeCmd.Source -v).Trim().TrimStart('v')
$nodeMajor = 0
if ($rawNodeVer -match '^(\d+)\.') {
    $nodeMajor = [int]$Matches[1]
}

if ($nodeMajor -lt 20) {
    Write-Err "Found Node.js v$rawNodeVer. MAOS Oasis requires Node.js >= 20.0.0."
    Write-Host "Please upgrade Node.js via 'winget upgrade OpenJS.NodeJS.LTS' or visit https://nodejs.org/"
    exit 1
}
Write-Ok "Node.js v$rawNodeVer detected (>= 20.0.0 requirement met)."

$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    $npmCmd = Get-Command npm.exe -ErrorAction SilentlyContinue
}
if (-not $npmCmd) {
    Write-Err "npm executable was not found on PATH."
    exit 1
}
$npmVer = (& $npmCmd.Source -v).Trim()
Write-Ok "npm v$npmVer detected."

# -- Stage 2: MAOS Oasis Package Installation ----------------------------------
Write-Step "Checking MAOS Oasis CLI package..."

$oasisCmd = Get-Command maos-oasis.cmd -ErrorAction SilentlyContinue
if (-not $oasisCmd) { $oasisCmd = Get-Command maos-oasis.exe -ErrorAction SilentlyContinue }
if (-not $oasisCmd) { $oasisCmd = Get-Command maos-oasis.ps1 -ErrorAction SilentlyContinue }
if (-not $oasisCmd) { $oasisCmd = Get-Command maos-oasis -ErrorAction SilentlyContinue }

if ($oasisCmd) {
    $oasisPath = $oasisCmd.Source
    Write-Ok "MAOS Oasis is already installed ($oasisPath)."
} else {
    $npmPath = $npmCmd.Source
    if ($DryRun) {
        Write-Ok "[DRY-RUN] Would execute: $npmPath install -g $PackageSource"
    } else {
        Write-Prog "Installing $PackageSource globally via npm..."
        & $npmPath install -g $PackageSource
        if ($LASTEXITCODE -ne 0) {
            if ($PackageSource -eq "maos-oasis") {
                Write-Info "Retrying with package 'maosorch'..."
                & $npmPath install -g maosorch
            }
        }
        Update-SessionPath -Force

        $oasisCmd = Get-Command maos-oasis.cmd -ErrorAction SilentlyContinue
        if (-not $oasisCmd) { $oasisCmd = Get-Command maos-oasis.exe -ErrorAction SilentlyContinue }
        if (-not $oasisCmd) { $oasisCmd = Get-Command maos-oasis.ps1 -ErrorAction SilentlyContinue }
        if (-not $oasisCmd) { $oasisCmd = Get-Command maos-oasis -ErrorAction SilentlyContinue }

        # Direct disk verification in npm global directory if session PATH has not updated
        if (-not $oasisCmd) {
            $npmGlobalDir = Join-Path $env:APPDATA "npm"
            $directCmd = Join-Path $npmGlobalDir "maos-oasis.cmd"
            $directPs1 = Join-Path $npmGlobalDir "maos-oasis.ps1"
            if (Test-Path $directCmd) {
                $oasisCmd = [PSCustomObject]@{ Source = $directCmd }
            } elseif (Test-Path $directPs1) {
                $oasisCmd = [PSCustomObject]@{ Source = $directPs1 }
            }
        }

        if ($oasisCmd) {
            Write-Ok "MAOS Oasis CLI installed successfully ($($oasisCmd.Source))."
        } else {
            Write-Err "Failed to install MAOS Oasis package globally via npm."
            Write-Host "Please verify npm registry access and network connectivity, then run:"
            Write-Host "  npm install -g $PackageSource"
            exit 1
        }
    }
}

# -- Stage 3: Hardware Sizing & GPU Probing ------------------------------------
Write-Step "Detecting hardware for Gemma model sizing..."

$gpuName = "Generic Graphics / CPU"
$vramMb = 0
$driverVersion = ""
$isNvidia = $false

# Probe 1: nvidia-smi
$nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if (-not $nvidiaSmi) {
    $standardSmi = "C:\Windows\System32\nvidia-smi.exe"
    if (Test-Path $standardSmi) {
        $nvidiaSmi = [PSCustomObject]@{ Source = $standardSmi }
    }
}

if ($nvidiaSmi) {
    try {
        $smiRaw = & $nvidiaSmi.Source --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null
        if ($smiRaw -and ($smiRaw.Count -gt 0)) {
            $parts = $smiRaw[0].Split(',')
            if ($parts.Length -ge 2) {
                $gpuName = $parts[0].Trim()
                $vramMb = [int]($parts[1].Trim())
                if ($parts.Length -ge 3) { $driverVersion = $parts[2].Trim() }
                $isNvidia = $true
            }
        }
    } catch {}
}

# Probe 2: Registry 64-bit qwMemorySize (bypasses 32-bit WMI uint32 4GB clamping)
if ($vramMb -eq 0) {
    try {
        $regGpus = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\000*" -ErrorAction SilentlyContinue
        if ($regGpus) {
            $bestGpuName = $gpuName
            $bestVramMb = $vramMb
            $bestDriverVersion = $driverVersion
            $bestIsNvidia = $isNvidia

            foreach ($entry in $regGpus) {
                # Strict-mode safe property inspection: returns $null instead of throwing PropertyNotFoundException
                $prop = $entry.PSObject.Properties['HardwareInformation.qwMemorySize']
                if ($prop -and $prop.Value -and ([int64]$prop.Value -gt 0)) {
                    $descProp = $entry.PSObject.Properties['DriverDesc']
                    $eName = if ($descProp -and $descProp.Value) { [string]$descProp.Value } else { "Generic Display Adapter" }
                    $bytes = [int64]$prop.Value
                    $eVramMb = [int]($bytes / (1024 * 1024))
                    $verProp = $entry.PSObject.Properties['DriverVersion']
                    $eDriverVer = if ($verProp -and $verProp.Value) { [string]$verProp.Value } else { "" }
                    $eIsNvidia = ($eName -like "*NVIDIA*")
                    $eIsDiscrete = ($eName -match '(NVIDIA|GeForce|RTX|GTX|Radeon|Arc)')

                    # Prioritize discrete cards and higher VRAM capacity
                    $shouldReplace = $false
                    if ($bestVramMb -eq 0) {
                        $shouldReplace = $true
                    } elseif ($eIsDiscrete -and (-not ($bestGpuName -match '(NVIDIA|GeForce|RTX|GTX|Radeon|Arc)'))) {
                        $shouldReplace = $true
                    } elseif ($eVramMb -gt $bestVramMb) {
                        $shouldReplace = $true
                    }

                    if ($shouldReplace) {
                        $bestGpuName = $eName
                        $bestVramMb = $eVramMb
                        $bestDriverVersion = $eDriverVer
                        $bestIsNvidia = $eIsNvidia
                    }
                }
            }

            if ($bestVramMb -gt 0) {
                $gpuName = $bestGpuName
                $vramMb = $bestVramMb
                $driverVersion = $bestDriverVersion
                $isNvidia = $bestIsNvidia
            }
        }
    } catch {}
}

# Probe 3: Win32_VideoController with name-based discrete card recognition
if ($vramMb -eq 0) {
    try {
        $cimGpus = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue
        if ($cimGpus) {
            $bestGpuName = $gpuName
            $bestVramMb = $vramMb
            $bestDriverVersion = $driverVersion
            $bestIsNvidia = $isNvidia

            foreach ($cim in $cimGpus) {
                $status = ""
                $statusProp = $cim.PSObject.Properties['Status']
                if ($statusProp -and $statusProp.Value) { $status = [string]$statusProp.Value }

                if ($status -eq 'OK' -or [string]::IsNullOrWhiteSpace($status)) {
                    $nameProp = $cim.PSObject.Properties['Name']
                    $cName = if ($nameProp -and $nameProp.Value) { [string]$nameProp.Value } else { "Generic Display Adapter" }
                    $cVram = 0
                    $cIsNvidia = ($cName -like "*NVIDIA*")
                    $cIsDiscrete = ($cName -match '(NVIDIA|GeForce|RTX|GTX|Radeon RX|Intel Arc)')

                    # Match discrete GPU series to avoid 32-bit uint32 AdapterRAM 4GB clamping
                    if ($cName -match '(RTX 40\d0|RTX 30\d0|RTX 20\d0|Radeon RX 7\d00|Radeon RX 6\d00)') {
                        if ($cName -match '(4090|3090)') {
                            $cVram = 24576
                        } elseif ($cName -match '(4080|3080)') {
                            $cVram = 16384
                        } elseif ($cName -match '(4070|3070)') {
                            $cVram = 12288
                        } elseif ($cName -match '(4060|3060|2060)') {
                            $cVram = 8192
                        } else {
                            $cVram = 6144
                        }
                    } else {
                        $ramProp = $cim.PSObject.Properties['AdapterRAM']
                        if ($ramProp -and $ramProp.Value) {
                            $rawBytes = [int64]$ramProp.Value
                            if ($rawBytes -gt 0) {
                                $cVram = [int]($rawBytes / (1024 * 1024))
                            }
                        }
                    }

                    $drvProp = $cim.PSObject.Properties['DriverVersion']
                    $cDrv = if ($drvProp -and $drvProp.Value) { [string]$drvProp.Value } else { "" }

                    # Prioritize discrete GPUs and higher VRAM capacity across all controllers
                    $shouldReplace = $false
                    if ($bestVramMb -eq 0) {
                        $shouldReplace = $true
                    } elseif ($cIsDiscrete -and (-not ($bestGpuName -match '(NVIDIA|GeForce|RTX|GTX|Radeon RX|Intel Arc)'))) {
                        $shouldReplace = $true
                    } elseif ($cVram -gt $bestVramMb) {
                        $shouldReplace = $true
                    }

                    if ($shouldReplace) {
                        $bestGpuName = $cName
                        $bestVramMb = $cVram
                        $bestDriverVersion = $cDrv
                        $bestIsNvidia = $cIsNvidia
                    }
                }
            }

            if ($bestVramMb -gt 0) {
                $gpuName = $bestGpuName
                $vramMb = $bestVramMb
                $driverVersion = $bestDriverVersion
                $isNvidia = $bestIsNvidia
            }
        }
    } catch {}
}

Write-Ok "Detected GPU: $gpuName"
if ($vramMb -gt 0) {
    $vramGb = [math]::Round($vramMb / 1024, 1)
    Write-Info "VRAM Capacity: $vramMb MB (~$vramGb GB)"
}
if ($driverVersion) {
    Write-Info "Driver Version: $driverVersion"
}

# Sizing Matrix Decision
$chosenModel = $Model
if ([string]::IsNullOrWhiteSpace($chosenModel)) {
    if ($vramMb -ge 6000) {
        $chosenModel = "gemma2:9b"
        Write-Info "Recommended Model: $chosenModel (High reasoning accuracy, optimized for RTX 4060 8GB / 6-8 GB VRAM)."
    } elseif ($vramMb -ge 4000) {
        $chosenModel = "gemma3:4b"
        Write-Info "Recommended Model: $chosenModel (Balanced performance for 4-6 GB VRAM)."
    } else {
        $chosenModel = "gemma2:2b"
        Write-Info "Recommended Model: $chosenModel (Lightweight, fast execution for CPU / <4 GB VRAM)."
    }
} else {
    Write-Info "Using user-specified model override: $chosenModel"
}

# -- Stage 4: Ollama Service Check & Startup -----------------------------------
Write-Step "Checking local Ollama runtime (127.0.0.1:11434)..."

$ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
    $defaultOllama = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path $defaultOllama) {
        $ollamaCmd = [PSCustomObject]@{ Source = $defaultOllama }
        $ollamaDir = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
        if ($env:Path -notlike "*$ollamaDir*") {
            $env:Path = "$ollamaDir;$env:Path"
        }
    }
}

if (-not $ollamaCmd) {
    Write-Warn "Ollama executable was not detected on PATH or standard directory."
    $wingetCmd = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($wingetCmd -and (-not $DryRun) -and (-not $NonInteractive)) {
        if (Prompt-Confirm "Install Ollama now via winget?" $true) {
            Write-Prog "Installing Ollama via winget..."
            $wingetPath = $wingetCmd.Source
            & $wingetPath install Ollama.Ollama --accept-source-agreements --accept-package-agreements
            Update-SessionPath -Force
            $ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
        }
    }

    if (-not $ollamaCmd) {
        Write-Warn "Ollama is required to host local Gemma models sovereignly."
        if ((-not $NonInteractive) -and (-not $DryRun)) {
            if (Prompt-Confirm "Open https://ollama.com/download in default browser?" $true) {
                Start-Process "https://ollama.com/download"
                Read-Host "Press Enter once Ollama installation is complete to continue"
                Update-SessionPath -Force
                $ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
            }
        }
    }
}

# Probe daemon connectivity
$ollamaLive = $false
try {
    $probe = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 -ErrorAction Stop
    $ollamaLive = $true
    Write-Ok "Ollama daemon is live and listening on 127.0.0.1:11434."
} catch {
    if ($ollamaCmd -and (-not $DryRun)) {
        Write-Prog "Ollama installed but daemon is stopped. Starting background service..."
        Start-Process -FilePath $ollamaCmd.Source -ArgumentList "serve" -WindowStyle Hidden

        for ($i = 0; $i -lt 10; $i++) {
            Start-Sleep -Seconds 1
            try {
                $probe = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 1 -ErrorAction Stop
                $ollamaLive = $true
                Write-Ok "Ollama daemon started successfully on 127.0.0.1:11434."
                break
            } catch {}
        }
        if (-not $ollamaLive) {
            Write-Warn "Could not reach Ollama daemon on 127.0.0.1:11434 within 10 seconds."
        }
    } else {
        Write-Warn "Ollama daemon is not reachable on 127.0.0.1:11434."
    }
}

# -- Stage 5: Model Presence Check & Pulling -----------------------------------
if ($ollamaLive -and (-not [string]::IsNullOrWhiteSpace($chosenModel))) {
    Write-Step "Checking Gemma model availability ($chosenModel)..."
    try {
        $tagsRes = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
        $modelFound = $false
        if ($tagsRes -and $tagsRes.models) {
            foreach ($m in $tagsRes.models) {
                if ($m.name -like "$chosenModel*") {
                    $modelFound = $true
                    break
                }
            }
        }

        if ($modelFound) {
            Write-Ok "Model '$chosenModel' is already present in local Ollama storage."
        } else {
            Write-Warn "Model '$chosenModel' is not downloaded locally in Ollama."
            if ($SkipPull) {
                Write-Info "Skipping model pull (-SkipPull / OASIS_SKIP_PULL=1)."
            } elseif ($DryRun) {
                $cmdSrc = if ($ollamaCmd) { $ollamaCmd.Source } else { "ollama.exe" }
                Write-Ok "[DRY-RUN] Would execute: $cmdSrc pull $chosenModel"
            } else {
                if (Prompt-Confirm "Pull model '$chosenModel' via Ollama now?" $true) {
                    Write-Prog "Pulling '$chosenModel' (this may take several minutes)..."
                    if ($ollamaCmd) {
                        & $ollamaCmd.Source pull $chosenModel
                    } else {
                        & ollama pull $chosenModel
                    }
                    if ($LASTEXITCODE -eq 0) {
                        Write-Ok "Model '$chosenModel' downloaded successfully."
                    } else {
                        Write-Warn "Model pull returned exit code $LASTEXITCODE."
                    }
                } else {
                    Write-Info "Skipping model pull. Run 'ollama pull $chosenModel' manually before starting Oasis."
                }
            }
        }
    } catch {
        Write-Warn "Failed to verify models with Ollama API: $_"
    }
}

# -- Stage 6: Herdr Terminal Multiplexer Offering ------------------------------
Write-Step "Checking Herdr multi-pane tiling tool..."

$herdrCmd = Get-Command herdr.exe -ErrorAction SilentlyContinue
if (-not $herdrCmd) {
    $herdrDefault = Join-Path $env:LOCALAPPDATA "Programs\Herdr\bin\herdr.exe"
    if (Test-Path $herdrDefault) {
        $herdrCmd = [PSCustomObject]@{ Source = $herdrDefault }
        $herdrBinDir = Join-Path $env:LOCALAPPDATA "Programs\Herdr\bin"
        if ($env:Path -notlike "*$herdrBinDir*") {
            $env:Path = "$herdrBinDir;$env:Path"
        }
    }
}

if ($herdrCmd) {
    Write-Ok "Herdr detected: Multi-pane terminal tiling enabled."
} else {
    Write-Warn "Herdr is not installed (provides live side-by-side agent terminal panes)."
    if (-not $DryRun) {
        if (Prompt-Confirm "Install Herdr now via 'irm https://herdr.dev/install.ps1 | iex'?" $false) {
            Write-Prog "Running Herdr installer..."
            try {
                Invoke-Expression (Invoke-RestMethod -Uri "https://herdr.dev/install.ps1")
                Update-SessionPath -Force
                $recheckHerdr = Get-Command herdr.exe -ErrorAction SilentlyContinue
                if ($recheckHerdr) {
                    Write-Ok "Herdr installed successfully."
                } else {
                    Write-Warn "Herdr installed; restart terminal if not visible in this session."
                }
            } catch {
                Write-Warn "Herdr installation encountered an issue; continuing in single-pane fallback mode."
            }
        } else {
            Write-Info "Skipping Herdr. MAOS Oasis will operate in single-pane fallback mode."
        }
    } else {
        Write-Info "[DRY-RUN] Would offer Herdr installation. Single-pane fallback mode enabled."
    }
}

# -- Stage 7: OpenCode AST Harness Offering ------------------------------------
Write-Step "Checking OpenCode harness..."

$opencodeCmd = Get-Command opencode.cmd -ErrorAction SilentlyContinue
if (-not $opencodeCmd) { $opencodeCmd = Get-Command opencode.ps1 -ErrorAction SilentlyContinue }
if (-not $opencodeCmd) { $opencodeCmd = Get-Command opencode.exe -ErrorAction SilentlyContinue }

if ($opencodeCmd) {
    Write-Ok "OpenCode detected: AST navigation and tool harness enabled."
} else {
    Write-Warn "OpenCode is not installed (provides AST symbol navigation and tool loops)."
    if (-not $DryRun) {
        $npmToolPath = $npmCmd.Source
        if (Prompt-Confirm "Install OpenCode now via '$npmToolPath install -g @opencode/cli'?" $false) {
            Write-Prog "Installing OpenCode globally..."
            & $npmToolPath install -g @opencode/cli
            if ($LASTEXITCODE -eq 0) {
                Update-SessionPath -Force
                Write-Ok "OpenCode installed successfully."
            } else {
                Write-Warn "OpenCode installation failed; continuing in direct loopback API fallback mode."
            }
        } else {
            Write-Info "Skipping OpenCode. MAOS Oasis will use direct loopback Ollama API fallback mode."
        }
    } else {
        Write-Info "[DRY-RUN] Would offer OpenCode installation. Direct loopback API fallback mode enabled."
    }
}

# -- Stage 8: Completion & Initialization Launch -------------------------------
Write-Host ""
Write-Ok "MAOS Oasis installation complete!"
Write-Host ""

if ($DryRun) {
    Write-Ok "[DRY-RUN] Dry run complete. No modifications were made."
    exit 0
}

if ($SkipInit) {
    Write-Host "To initialize your current workspace, run:" -ForegroundColor Cyan
    Write-Host "  maos-oasis init" -ForegroundColor Green
    exit 0
}

if ($NonInteractive) {
    $env:OASIS_NON_INTERACTIVE = '1'
    Write-Prog "Launching non-interactive workspace initialization..."
    if ($oasisCmd) {
        & $oasisCmd.Source init --non-interactive -y -m $chosenModel
    } else {
        Write-Err "Cannot launch initialization: maos-oasis executable is not available."
        exit 1
    }
} else {
    Write-Prog "Launching MAOS Oasis initialization wizard..."
    Start-Sleep -Seconds 1
    if ($oasisCmd) {
        & $oasisCmd.Source init -m $chosenModel
    } else {
        Write-Err "Cannot launch initialization wizard: maos-oasis executable is not available."
        exit 1
    }
}
