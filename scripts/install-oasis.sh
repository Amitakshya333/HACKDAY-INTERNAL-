#!/usr/bin/env bash
# ==============================================================================
# MAOS Oasis — Sovereign Multi-Agent Coding Swarm
# Linux One-Line Installer Script
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<org>/maos-oasis/main/scripts/install-oasis.sh | bash
#
# Environment Overrides & Flags:
#   OASIS_NON_INTERACTIVE=1   Run headlessly without interactive prompts (for CI/Docker)
#   OASIS_SKIP_INIT=1         Skip launching maos-oasis init at end of installation
#   OASIS_MODEL=<tag>         Override Gemma model tag (e.g. gemma2:9b, gemma2:2b, gemma4:e4b)
#   OASIS_SKIP_PULL=1         Skip pulling model via Ollama
#   OASIS_DRY_RUN=1           Simulate inspection without modifying system packages
#   OASIS_DEBUG=1             Enable verbose trace logging (set -x)
#   OASIS_PACKAGE_NAME=<pkg>  Override npm package name (default: maos-oasis)
# ==============================================================================

set -Eeuo pipefail

# Argument parsing for direct execution
for arg in "$@"; do
  case "$arg" in
    --non-interactive|-y|--yes)
      export OASIS_NON_INTERACTIVE=1
      ;;
    --skip-init)
      export OASIS_SKIP_INIT=1
      ;;
    --skip-pull)
      export OASIS_SKIP_PULL=1
      ;;
    --dry-run)
      export OASIS_DRY_RUN=1
      ;;
    --debug)
      export OASIS_DEBUG=1
      ;;
    --model=*)
      export OASIS_MODEL="${arg#*=}"
      ;;
  esac
done

if [ "${OASIS_DEBUG:-0}" = "1" ]; then
  set -x
fi

# Visual Formatting (with non-TTY color suppression)
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  BLUE="\033[34m"
  CYAN="\033[36m"
  RED="\033[31m"
  RESET="\033[0m"
else
  BOLD=""
  GREEN=""
  YELLOW=""
  BLUE=""
  CYAN=""
  RED=""
  RESET=""
fi

log_info()  { echo -e "${CYAN}ℹ${RESET} $1"; }
log_step()  { echo -e "${BLUE}▶${RESET} ${BOLD}$1${RESET}"; }
log_ok()    { echo -e "${GREEN}✔${RESET} $1"; }
log_warn()  { echo -e "${YELLOW}⚠${RESET} $1"; }
log_error() { echo -e "${RED}✖${RESET} $1" >&2; }

# Trap handlers
cleanup() {
  local exit_code=$?
  if [ -n "${TMP_STAGE_DIR:-}" ] && [ -d "${TMP_STAGE_DIR:-}" ]; then
    rm -rf "${TMP_STAGE_DIR}" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

handle_error() {
  local exit_code="$1"
  local line_no="$2"
  log_error "Installation failed at line ${line_no} with exit code ${exit_code}."
  log_info "For troubleshooting, run with OASIS_DEBUG=1: curl -fsSL ... | OASIS_DEBUG=1 bash"
}
trap 'handle_error $? $LINENO' ERR

# Robust check for an attached, accessible controlling terminal device
has_controlling_tty() {
  [ -e /dev/tty ] && (exec </dev/tty) 2>/dev/null
}

prompt_confirm() {
  local prompt_text="$1"
  local default_choice="${2:-Y}"

  if [ "${OASIS_NON_INTERACTIVE:-0}" = "1" ] || [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ] || ! has_controlling_tty; then
    [ "$default_choice" = "Y" ] && return 0 || return 1
  fi

  local prompt_bracket="[Y/n]"
  [ "$default_choice" = "N" ] && prompt_bracket="[y/N]"

  echo -ne "${BOLD}${prompt_text} ${prompt_bracket}: ${RESET}" >/dev/tty
  local reply
  read -r reply </dev/tty || reply="$default_choice"
  reply="${reply:-$default_choice}"

  case "$reply" in
    [Yy]* ) return 0 ;;
    * ) return 1 ;;
  esac
}

check_linux_os() {
  local os_type
  os_type="$(uname -s)"
  if [ "$os_type" != "Linux" ]; then
    if [ "${OASIS_DRY_RUN:-0}" = "1" ]; then
      log_warn "[DRY-RUN] Running in simulation on non-Linux host (detected: $os_type). Continuing dry-run traversal."
      return 0
    fi
    log_error "This installer is specifically designed for Linux environments (detected: $os_type)."
    echo ""
    echo "For Windows PowerShell installation, run:"
    echo "  irm https://raw.githubusercontent.com/<org>/maos-oasis/main/scripts/install-oasis.ps1 | iex"
    echo ""
    echo "Or install manually via npm:"
    echo "  npm install -g maos-oasis && maos-oasis init"
    exit 1
  fi
}

install_nodejs_lts() {
  log_step "Attempting automatic installation of Node.js 20 LTS..."
  local sudo_cmd=""
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
      sudo_cmd="sudo"
    else
      log_error "Root privileges or sudo are required to install Node.js."
      exit 1
    fi
  fi

  if command -v apt-get >/dev/null 2>&1; then
    if [ -n "$sudo_cmd" ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | $sudo_cmd -E bash -
    else
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    fi
    $sudo_cmd apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    if [ -n "$sudo_cmd" ]; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | $sudo_cmd bash -
    else
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    fi
    $sudo_cmd dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    if [ -n "$sudo_cmd" ]; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | $sudo_cmd bash -
    else
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    fi
    $sudo_cmd yum install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then
    $sudo_cmd pacman -Sy --noconfirm nodejs npm
  elif command -v apk >/dev/null 2>&1; then
    $sudo_cmd apk add --no-cache nodejs npm
  elif command -v zypper >/dev/null 2>&1; then
    $sudo_cmd zypper install -y nodejs20 npm20 || $sudo_cmd zypper install -y nodejs npm
  else
    log_error "Could not detect a supported package manager (apt-get, dnf, yum, pacman, apk, zypper)."
    log_info "Please install Node.js >= 20 manually: https://nodejs.org/"
    exit 1
  fi
}

check_node_and_npm() {
  log_step "Checking Node.js & npm prerequisites..."
  local node_ok=0

  if command -v node >/dev/null 2>&1; then
    local node_ver
    node_ver="$(node -v 2>/dev/null | tr -d 'v\r\n ')"
    local node_major="${node_ver%%.*}"
    if [[ "$node_major" =~ ^[0-9]+$ ]] && [ "$node_major" -ge 20 ]; then
      node_ok=1
      log_ok "Node.js v${node_ver} detected (>= 20.0.0 required)."
    else
      log_warn "Node.js v${node_ver} detected, but Node.js 20+ LTS is required."
    fi
  else
    log_warn "Node.js is not installed on PATH."
  fi

  if [ "$node_ok" -eq 0 ]; then
    if [ "${OASIS_NON_INTERACTIVE:-0}" = "1" ] || [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
      log_error "Node.js >= 20.0.0 is strictly required to run MAOS Oasis."
      log_info "Please install Node.js 20 LTS from https://nodejs.org/"
      exit 1
    fi

    if prompt_confirm "Would you like to install Node.js 20 LTS automatically?" "Y"; then
      install_nodejs_lts
    else
      log_error "Node.js >= 20.0.0 is strictly required to run MAOS Oasis."
      exit 1
    fi
  fi

  if ! command -v npm >/dev/null 2>&1; then
    log_error "npm command not found. Please ensure npm is installed alongside Node.js."
    exit 1
  fi
  log_ok "npm v$(npm -v 2>/dev/null) detected."
}

install_maos_package() {
  log_step "Installing MAOS Oasis globally via npm..."
  local pkg_name="${OASIS_PACKAGE_NAME:-maos-oasis}"

  if [ "${OASIS_DRY_RUN:-0}" = "1" ]; then
    log_ok "[DRY-RUN] Would execute: npm install -g ${pkg_name}"
    return 0
  fi

  # If maos-oasis is already executable on PATH, reuse it
  if command -v maos-oasis >/dev/null 2>&1; then
    log_ok "MAOS Oasis is already installed: $(command -v maos-oasis)"
    return 0
  fi

  local installed=0
  local npm_prefix
  npm_prefix="$(npm config get prefix 2>/dev/null || echo '/usr/local')"
  local needs_sudo=0
  if [ ! -w "$npm_prefix" ] && [ "$(id -u)" -ne 0 ]; then
    needs_sudo=1
  fi

  if [ "$needs_sudo" -eq 0 ]; then
    if npm install -g "$pkg_name" 2>/dev/null; then
      installed=1
    fi
  fi

  if [ "$installed" -eq 0 ]; then
    log_info "Elevated permissions required for global npm prefix. Using sudo..."
    if command -v sudo >/dev/null 2>&1; then
      if sudo npm install -g "$pkg_name"; then
        installed=1
      elif sudo npm install -g maosorch; then
        installed=1
      fi
    else
      log_error "sudo is not available and npm global directory is not writable."
      log_info "Configure a user-level npm prefix: npm config set prefix '~/.npm-global'"
      exit 1
    fi
  fi

  if [ "$installed" -eq 0 ]; then
    log_error "Failed to install MAOS Oasis package globally via npm."
    exit 1
  fi

  # Ensure global bin is on current PATH
  local global_bin
  global_bin="$(npm bin -g 2>/dev/null || echo "${npm_prefix}/bin")"
  if [[ ":$PATH:" != *":$global_bin:"* ]]; then
    export PATH="${global_bin}:${PATH}"
  fi

  if command -v maos-oasis >/dev/null 2>&1; then
    log_ok "MAOS Oasis CLI binary installed successfully: $(command -v maos-oasis)"
  else
    log_warn "maos-oasis installed to ${global_bin}, but is not currently on PATH."
    log_info "Add this line to your ~/.bashrc: export PATH=\"${global_bin}:\$PATH\""
  fi
}

detect_and_start_ollama() {
  log_step "Checking local Ollama service (127.0.0.1:11434)..."
  local ollama_installed=0
  local ollama_bin=""

  if command -v ollama >/dev/null 2>&1; then
    ollama_installed=1
    ollama_bin="$(command -v ollama)"
  elif [ -x /usr/local/bin/ollama ]; then
    ollama_installed=1
    ollama_bin="/usr/local/bin/ollama"
  elif [ -x /usr/bin/ollama ]; then
    ollama_installed=1
    ollama_bin="/usr/bin/ollama"
  fi

  if [ "${OASIS_DRY_RUN:-0}" = "1" ]; then
    if [ "$ollama_installed" -eq 1 ]; then
      log_ok "[DRY-RUN] Ollama binary detected: ${ollama_bin}"
    else
      log_warn "[DRY-RUN] Ollama not found on PATH. Would offer installation."
    fi
    OLLAMA_IS_RUNNING=0
    return 0
  fi

  if [ "$ollama_installed" -eq 0 ]; then
    log_warn "Ollama is not installed. Local Gemma models require Ollama."
    if prompt_confirm "Install Ollama now via https://ollama.com/install.sh?" "Y"; then
      log_step "Running official Ollama installer..."
      if curl -fsSL https://ollama.com/install.sh | sh; then
        if command -v ollama >/dev/null 2>&1; then
          ollama_installed=1
          ollama_bin="$(command -v ollama)"
          log_ok "Ollama installed successfully: ${ollama_bin}"
        elif [ -x /usr/local/bin/ollama ]; then
          ollama_installed=1
          ollama_bin="/usr/local/bin/ollama"
          log_ok "Ollama installed successfully: ${ollama_bin}"
        elif [ -x /usr/bin/ollama ]; then
          ollama_installed=1
          ollama_bin="/usr/bin/ollama"
          log_ok "Ollama installed successfully: ${ollama_bin}"
        fi
      else
        log_warn "Ollama installer script returned a non-zero exit code."
        log_info "You can install Ollama manually from https://ollama.com/download"
      fi
    else
      log_warn "Skipped Ollama installation. Sovereign local inference will be unavailable until installed."
    fi
  else
    log_ok "Ollama binary found: ${ollama_bin}"
  fi

  # Probe loopback daemon connectivity
  local daemon_running=0
  if curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    daemon_running=1
    log_ok "Ollama daemon is running and reachable on 127.0.0.1:11434."
  elif [ "$ollama_installed" -eq 1 ]; then
    log_info "Ollama daemon is not responding. Starting service..."
    if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled ollama >/dev/null 2>&1; then
      if [ "$(id -u)" -eq 0 ]; then
        systemctl start ollama 2>/dev/null || true
      elif command -v sudo >/dev/null 2>&1; then
        sudo systemctl start ollama 2>/dev/null || true
      fi
    else
      nohup "${ollama_bin}" serve >/dev/null 2>&1 &
    fi

    log_info "Waiting for Ollama loopback endpoint to become ready..."
    for _ in {1..12}; do
      if curl -s -m 1 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
        daemon_running=1
        log_ok "Ollama daemon started successfully."
        break
      fi
      sleep 1
    done

    if [ "$daemon_running" -eq 0 ]; then
      log_warn "Ollama daemon did not respond within 12 seconds. Run 'ollama serve' manually if needed."
    fi
  fi

  OLLAMA_IS_RUNNING="$daemon_running"
}

detect_hardware_and_pull_model() {
  local chosen_model="${OASIS_MODEL:-}"
  local vram_mb=0

  if [ -z "$chosen_model" ]; then
    log_step "Probing hardware for Gemma model selection..."
    if command -v nvidia-smi >/dev/null 2>&1; then
      local smi_out
      smi_out="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ' || echo 0)"
      if [[ "$smi_out" =~ ^[0-9]+$ ]] && [ "$smi_out" -gt 0 ]; then
        vram_mb="$smi_out"
        log_info "NVIDIA GPU detected: ${vram_mb} MB VRAM."
      fi
    elif command -v rocm-smi >/dev/null 2>&1; then
      log_info "AMD ROCm GPU detected."
      vram_mb=4096
    fi

    if [ "$vram_mb" -ge 6000 ]; then
      chosen_model="gemma2:9b"
      log_info "Model recommendation: ${BOLD}${GREEN}${chosen_model}${RESET} (High-accuracy reasoning for >=6GB VRAM / RTX 4060)."
    elif [ "$vram_mb" -ge 4000 ]; then
      chosen_model="gemma3:4b"
      log_info "Model recommendation: ${BOLD}${CYAN}${chosen_model}${RESET} (Balanced 4-6GB VRAM envelope)."
    else
      chosen_model="gemma2:2b"
      log_info "Model recommendation: ${BOLD}${YELLOW}${chosen_model}${RESET} (Lightweight, CPU / <4GB VRAM fallback)."
    fi
  else
    log_info "Using user-specified model override: ${BOLD}${chosen_model}${RESET}"
  fi

  RECOMMENDED_MODEL="$chosen_model"

  if [ "${OASIS_DRY_RUN:-0}" = "1" ]; then
    log_ok "[DRY-RUN] Model resolved: ${chosen_model}. Would execute: ollama pull ${chosen_model}"
    return 0
  fi

  if [ "${OASIS_SKIP_PULL:-0}" = "1" ]; then
    log_info "Skipping model pull (OASIS_SKIP_PULL=1)."
    return 0
  fi

  # Check if model already cached
  if [ "${OLLAMA_IS_RUNNING:-0}" = "1" ] && [ -n "$chosen_model" ]; then
    local model_cached=0
    if curl -s http://127.0.0.1:11434/api/tags 2>/dev/null | grep -q "\"${chosen_model}\""; then
      model_cached=1
      log_ok "Gemma model '${chosen_model}' is already cached locally."
    fi

    if [ "$model_cached" -eq 0 ]; then
      if prompt_confirm "Pull recommended model '${chosen_model}' via Ollama now?" "Y"; then
        log_step "Pulling model '${chosen_model}' (this may take several minutes)..."
        if ollama pull "$chosen_model"; then
          log_ok "Model '${chosen_model}' pulled successfully."
        else
          log_warn "Failed to pull model '${chosen_model}' (network timeout or pull interrupted)."
          log_info "You can pull the model later manually by running: ${BOLD}ollama pull ${chosen_model}${RESET}"
        fi
      else
        log_warn "Skipped model pull. You can pull it later with: ollama pull ${chosen_model}"
      fi
    fi
  fi
}

check_companion_toolchains() {
  # 1. Herdr Check & Installation
  log_step "Checking companion toolchain: Herdr (Multi-pane agent tiling)..."
  if command -v herdr >/dev/null 2>&1; then
    log_ok "Herdr detected: $(herdr --version 2>/dev/null || echo 'installed')."
  else
    log_warn "Herdr is not installed (provides side-by-side terminal panes for swarm agents)."
    if [ "${OASIS_DRY_RUN:-0}" = "1" ]; then
      log_info "[DRY-RUN] Would offer Herdr installation. Single-pane fallback mode enabled."
    else
      if prompt_confirm "Install Herdr now via https://herdr.dev/install.sh?" "N"; then
        log_step "Installing Herdr..."
        if curl -fsSL https://herdr.dev/install.sh | sh; then
          log_ok "Herdr installed successfully."
        else
          log_warn "Herdr installation encountered an error. Operating in single-pane fallback mode (all agent logs stream sequentially)."
        fi
      else
        log_info "Skipping Herdr. Operating in single-pane fallback mode (all agent logs stream sequentially)."
      fi
    fi
  fi

  # 2. OpenCode Check & Installation
  log_step "Checking companion toolchain: OpenCode (AST navigation & tool harness)..."
  if command -v opencode >/dev/null 2>&1; then
    log_ok "OpenCode detected: $(opencode --version 2>/dev/null || echo 'installed')."
  else
    log_warn "OpenCode is not installed (provides AST-aware navigation and tool harness loops)."
    if [ "${OASIS_DRY_RUN:-0}" = "1" ]; then
      log_info "[DRY-RUN] Would offer OpenCode installation. Direct loopback API fallback mode enabled."
    else
      if prompt_confirm "Install OpenCode now via 'npm install -g @opencode/cli'?" "N"; then
        log_step "Installing OpenCode globally..."
        if npm install -g @opencode/cli 2>/dev/null || sudo npm install -g @opencode/cli; then
          log_ok "OpenCode installed successfully."
        else
          log_warn "OpenCode installation encountered an error. Operating in direct loopback Ollama API fallback mode."
        fi
      else
        log_info "Skipping OpenCode. Operating in direct loopback Ollama API fallback mode."
      fi
    fi
  fi
}

launch_init_wizard() {
  echo ""
  log_ok "MAOS Oasis system installation completed successfully!"
  echo ""

  if [ "${OASIS_DRY_RUN:-0}" = "1" ]; then
    log_ok "[DRY-RUN] Dry-run simulation completed successfully. No system modifications were made."
    return 0
  fi

  if [ "${OASIS_SKIP_INIT:-0}" = "1" ]; then
    log_info "Workspace initialization skipped (OASIS_SKIP_INIT=1)."
    echo -e "To initialize your current project, run:\n  ${BOLD}${CYAN}maos-oasis init${RESET}"
    return 0
  fi

  local model_flag=""
  if [ -n "${RECOMMENDED_MODEL:-}" ]; then
    model_flag="-m ${RECOMMENDED_MODEL}"
  fi

  if [ "${OASIS_NON_INTERACTIVE:-0}" = "1" ] || [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
    log_info "Non-interactive environment detected. Initializing workspace with default settings..."
    maos-oasis init --non-interactive --yes ${model_flag}
    return 0
  fi

  log_step "Launching MAOS Oasis Initialization Wizard..."
  sleep 1

  # Terminal /dev/tty preservation logic for piped curl execution
  if [ -t 0 ]; then
    maos-oasis init ${model_flag}
  elif has_controlling_tty; then
    maos-oasis init ${model_flag} </dev/tty
  else
    log_warn "No interactive terminal device (/dev/tty) available."
    echo -e "Run initialization manually inside your project directory:\n  ${BOLD}${CYAN}maos-oasis init${RESET}"
  fi
}

main() {
  clear 2>/dev/null || true
  echo -e "${CYAN}${BOLD}"
  echo "╭────────────────────────────────────────────────────────╮"
  echo "│  MAOS Oasis — Sovereign Multi-Agent Coding Swarm       │"
  echo "│  Gemma-First · 100% Local Loopback · Zero Cloud        │"
  echo "╰────────────────────────────────────────────────────────╯"
  echo -e "${RESET}"

  if [ "${OASIS_DRY_RUN:-0}" = "1" ]; then
    log_info "[DRY-RUN] Dry-run simulation active — no system changes will be made."
    echo ""
  fi

  check_linux_os
  check_node_and_npm
  install_maos_package
  detect_and_start_ollama
  detect_hardware_and_pull_model
  check_companion_toolchains
  launch_init_wizard
}

main "$@"
