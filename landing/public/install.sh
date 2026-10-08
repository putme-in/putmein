#!/usr/bin/env bash

# ==============================================================================
# PutmeIn Universal Installation Script
# Supports: Linux (Ubuntu, Debian, Fedora, CentOS, Arch, Alpine) & macOS & WSL
# ==============================================================================

set -e

# Terminal Colors & Formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Output Helpers
info()    { echo -e "${CYAN}➜${NC} $1"; }
step()    { echo -e "\n${BOLD}${BLUE}[$1]${NC} ${BOLD}$2${NC}"; }
success() { echo -e "  ${GREEN}✔${NC} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; }
error()   { echo -e "  ${RED}✖${NC} $1"; }

# Cleanup on interruption
cleanup() {
  echo -e "\n${YELLOW}Installation interrupted by user.${NC}"
  exit 1
}
trap cleanup SIGINT SIGTERM

# Spinner helper for long tasks
run_with_spinner() {
  local msg="$1"
  shift
  local temp_log
  temp_log=$(mktemp)

  # Start background process
  "$@" >"$temp_log" 2>&1 &
  local pid=$!

  local spin='-\|/'
  local i=0
  printf "  ${CYAN}⏳${NC} %s " "$msg"

  while kill -0 "$pid" 2>/dev/null; do
    i=$(( (i+1) % 4 ))
    printf "\\b%s" "${spin:$i:1}"
    sleep 0.15
  done

  printf "\b "

  if wait "$pid"; then
    echo -e "\r  ${GREEN}✔${NC} $msg"
    rm -f "$temp_log"
    return 0
  else
    echo -e "\r  ${RED}✖${NC} $msg (failed)"
    echo -e "${DIM}--- Error details ---${NC}"
    cat "$temp_log" | tail -n 20
    echo -e "${DIM}---------------------${NC}"
    rm -f "$temp_log"
    return 1
  fi
}

# Elevation helper (sudo)
run_elevated() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo &>/dev/null; then
    sudo "$@"
  else
    error "Elevated permissions (root/sudo) are required to proceed."
    exit 1
  fi
}

# APT Lock helper to handle Ubuntu unattended-upgrades automatically and swiftly
wait_for_apt_lock() {
  if ! command -v apt-get &>/dev/null; then
    return 0
  fi

  export DEBIAN_FRONTEND=noninteractive

  # Stop unattended-upgrades service so it doesn't contest the lock
  systemctl stop unattended-upgrades.service 2>/dev/null || true

  local lock_files=("/var/lib/dpkg/lock-frontend" "/var/lib/dpkg/lock" "/var/lib/apt/lists/lock")
  local is_locked=false
  for lf in "${lock_files[@]}"; do
    if [ -f "$lf" ] && command -v fuser &>/dev/null && fuser "$lf" >/dev/null 2>&1; then
      is_locked=true
      break
    fi
  done

  if [ "$is_locked" = true ]; then
    info "Resolving system package manager background lock automatically..."
    local waited=0
    while true; do
      local still_locked=false
      for lf in "${lock_files[@]}"; do
        if [ -f "$lf" ] && command -v fuser &>/dev/null && fuser "$lf" >/dev/null 2>&1; then
          still_locked=true
          break
        fi
      done
      if [ "$still_locked" = false ]; then
        break
      fi
      sleep 2
      waited=$((waited + 2))
      if [ "$waited" -ge 8 ]; then
        # Force release lock cleanly
        killall -9 unattended-upgr 2>/dev/null || true
        killall apt apt-get 2>/dev/null || true
        sleep 1
        rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock 2>/dev/null || true
        dpkg --configure -a 2>/dev/null || true
        break
      fi
    done
  fi
}

# Get Network IP
get_lan_ip() {
  local ip=""
  if command -v ip &>/dev/null; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
  elif command -v ifconfig &>/dev/null; then
    ip=$(ifconfig | grep -E "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
  fi
  if [ -z "$ip" ]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

# Banner
clear 2>/dev/null || true
echo -e "${CYAN}"
cat << "EOF"
██████╗ ██╗   ██╗████████╗███╗   ███╗███████╗   ██╗███╗   ██╗
██╔══██╗██║   ██║╚══██╔══╝████╗ ████║██╔════╝   ██║████╗  ██║
██████╔╝██║   ██║   ██║   ██╔████╔██║█████╗     ██║██╔██╗ ██║
██╔═══╝ ██║   ██║   ██║   ██║╚██╔╝██║██╔══╝     ██║██║╚██╗██║
██║     ╚██████╔╝   ██║   ██║ ╚═╝ ██║███████╗██╗██║██║ ╚████║
╚═╝      ╚═════╝    ╚═╝   ╚═╝     ╚═╝╚══════╝╚═╝╚═╝╚═╝  ╚═══╝
EOF
echo -e "${NC}"
echo -e "${BOLD}Autonomous DevOps, Infrastructure Monitoring & Deployment Engine${NC}"
echo -e "${DIM}Universal Installer • https://putme.in${NC}"
echo -e "────────────────────────────────────────────────────────────────────────"

# ==============================================================================
# Step 1: Detect Operating System & Architecture
# ==============================================================================
step "1/6" "Detecting System & Architecture..."

OS_TYPE="$(uname -s)"
ARCH_TYPE="$(uname -m)"

case "$OS_TYPE" in
  Linux*)   OS="Linux" ;;
  Darwin*)  OS="macOS" ;;
  MINGW*|MSYS*|CYGWIN*) OS="Windows" ;;
  *)        OS="Unknown" ;;
esac

case "$ARCH_TYPE" in
  x86_64|amd64)   ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             ARCH="$ARCH_TYPE" ;;
esac

success "Operating System: $OS ($ARCH)"

if [ "$OS" = "Windows" ]; then
  echo ""
  warn "PutmeIn has a dedicated native Windows PowerShell installer!"
  echo ""
  info "Please open PowerShell or Windows Terminal and run:"
  echo ""
  echo -e "  ${BOLD}${CYAN}powershell -c \"irm https://putme.in/install.ps1 | iex\"${NC}"
  echo ""
  echo -e "  Or simply inside PowerShell:"
  echo -e "  ${BOLD}${CYAN}irm https://putme.in/install.ps1 | iex${NC}"
  echo ""
  exit 0
fi

# ==============================================================================
# Step 2: Check & Configure Docker Engine
# ==============================================================================
step "2/6" "Checking Container Runtime (Docker)..."

install_docker_linux() {
  wait_for_apt_lock
  info "Installing Docker Engine via official convenience script..."
  run_elevated sh -c "curl -fsSL https://get.docker.com | sh"
  if [ -n "$SUDO_USER" ]; then
    run_elevated usermod -aG docker "$SUDO_USER" || true
  elif [ "$USER" != "root" ]; then
    run_elevated usermod -aG docker "$USER" || true
  fi
  run_elevated systemctl enable --now docker 2>/dev/null || run_elevated service docker start 2>/dev/null || true
}

if command -v docker &>/dev/null && docker info &>/dev/null; then
  DOCKER_VER=$(docker --version | awk '{print $3}' | tr -d ',')
  success "Docker is installed and active ($DOCKER_VER)"
elif command -v docker &>/dev/null; then
  warn "Docker command found, but daemon is not running."
  if [ "$OS" = "Linux" ]; then
    info "Attempting to start Docker service..."
    run_elevated systemctl start docker 2>/dev/null || run_elevated service docker start 2>/dev/null || true
  elif [ "$OS" = "macOS" ]; then
    if [ -d "/Applications/Docker.app" ]; then
      info "Launching Docker Desktop on macOS..."
      open -a Docker
    fi
  fi
  # Re-test
  sleep 3
  if docker info &>/dev/null; then
    success "Docker daemon started successfully."
  else
    warn "Could not start Docker automatically. Please ensure Docker Desktop is open."
  fi
else
  info "Docker not found on system."
  if [ "$OS" = "Linux" ]; then
    install_docker_linux
    if docker info &>/dev/null; then
      success "Docker installed and running!"
    else
      warn "Docker was installed. You may need to log out and back in for group permissions."
    fi
  elif [ "$OS" = "macOS" ]; then
    if command -v brew &>/dev/null; then
      info "Installing Docker Desktop via Homebrew..."
      brew install --cask docker
      open -a Docker 2>/dev/null || true
      success "Docker Desktop installed. Please grant hypervisor permissions if prompted."
    else
      warn "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/"
    fi
  fi
fi

# ==============================================================================
# Step 3: Check & Install Node.js & NPM
# ==============================================================================
step "3/6" "Checking Node.js & npm Environment..."

install_node_linux() {
  info "Installing Node.js LTS (v20) and npm..."
  wait_for_apt_lock
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | run_elevated bash -
    wait_for_apt_lock
    run_elevated apt-get -o DPkg::Lock::Timeout=60 update -qq || true
    run_elevated apt-get -o DPkg::Lock::Timeout=60 install -y -qq nodejs
  elif command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | run_elevated bash -
    run_elevated dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | run_elevated bash -
    run_elevated yum install -y nodejs
  elif command -v pacman &>/dev/null; then
    run_elevated pacman -Sy --noconfirm nodejs npm
  elif command -v apk &>/dev/null; then
    run_elevated apk add --no-cache nodejs npm
  fi
}

HAS_NODE=false
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -v 2>/dev/null | cut -d'.' -f1 | tr -d 'v')
  if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 20 ]; then
    HAS_NODE=true
  else
    warn "Node.js is installed but version ($NODE_MAJOR) is too old (requires >= 20)."
  fi
fi

if [ "$HAS_NODE" = false ]; then
  if [ "$OS" = "Linux" ]; then
    install_node_linux
  elif [ "$OS" = "macOS" ]; then
    if command -v brew &>/dev/null; then
      brew install node
    else
      error "Homebrew not found. Please install Node.js and npm from https://nodejs.org/"
      exit 1
    fi
  fi
fi

# If node is present but npm is missing (common on Ubuntu/Debian where packages are separate)
if ! command -v npm &>/dev/null; then
  info "npm package is missing. Installing npm..."
  if [ "$OS" = "Linux" ]; then
    if command -v apt-get &>/dev/null; then
      wait_for_apt_lock
      run_elevated apt-get -o DPkg::Lock::Timeout=60 update -qq || true
      run_elevated apt-get -o DPkg::Lock::Timeout=60 install -y -qq npm || true
    elif command -v dnf &>/dev/null; then
      run_elevated dnf install -y npm || true
    elif command -v yum &>/dev/null; then
      run_elevated yum install -y npm || true
    elif command -v pacman &>/dev/null; then
      run_elevated pacman -Sy --noconfirm npm || true
    elif command -v apk &>/dev/null; then
      run_elevated apk add --no-cache npm || true
    fi
  fi
fi

if command -v node &>/dev/null && command -v npm &>/dev/null; then
  success "Node.js $(node -v) is available"
  success "npm v$(npm -v) is available"
else
  error "Node.js (>= 20) and npm are required. Please install them and re-run this script."
  exit 1
fi

# Ensure npm global binary path is in current shell session's PATH
NPM_PREFIX=$(npm config get prefix 2>/dev/null || echo "/usr/local")
if [ -d "$NPM_PREFIX/bin" ] && [[ ":$PATH:" != *":$NPM_PREFIX/bin:"* ]]; then
  export PATH="$NPM_PREFIX/bin:$PATH"
fi
if [ -d "/usr/local/bin" ] && [[ ":$PATH:" != *":/usr/local/bin:"* ]]; then
  export PATH="/usr/local/bin:$PATH"
fi

# ==============================================================================
# Step 4: Check & Install PM2
# ==============================================================================
step "4/6" "Checking Process Manager (PM2)..."

if command -v pm2 &>/dev/null; then
  success "PM2 is already installed ($(pm2 -v))"
else
  info "Installing PM2 globally..."
  if npm install -g pm2 2>/dev/null; then
    success "PM2 installed globally!"
  else
    warn "Direct global install failed. Attempting with elevated privileges..."
    run_elevated npm install -g pm2
    success "PM2 installed successfully!"
  fi
fi

# ==============================================================================
# Step 5: Setup Local MySQL via Docker
# ==============================================================================
step "5/6" "Configuring Database & Environment..."

PUTMEIN_CONFIG_DIR="$HOME/.putmein"
PUTMEIN_ENV_FILE="$PUTMEIN_CONFIG_DIR/.env"
mkdir -p "$PUTMEIN_CONFIG_DIR"

MYSQL_CONTAINER="putmein-mysql"
MYSQL_PORT="3306"

# Check if MySQL container is already running
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${MYSQL_CONTAINER}$"; then
  success "Persistent MySQL container ($MYSQL_CONTAINER) is running"
elif docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${MYSQL_CONTAINER}$"; then
  info "Starting existing MySQL container..."
  docker start "$MYSQL_CONTAINER" >/dev/null
  success "MySQL container started"
else
  # Generate a secure 32-character random root password and 64-character JWT secret
  if command -v openssl &>/dev/null; then
    DB_PASSWORD=$(openssl rand -hex 16)
    JWT_SECRET=$(openssl rand -hex 32)
  else
    DB_PASSWORD=$(LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom 2>/dev/null | head -c 32 || date +%s)
    JWT_SECRET=$(LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom 2>/dev/null | head -c 64 || date +%s%N)
  fi

  info "Creating dedicated MySQL container on port $MYSQL_PORT..."
  docker run -d \
    --name "$MYSQL_CONTAINER" \
    --restart unless-stopped \
    -p "127.0.0.1:${MYSQL_PORT}:3306" \
    -e "MYSQL_ROOT_PASSWORD=${DB_PASSWORD}" \
    -e "MYSQL_DATABASE=putmein" \
    -v "putmein_mysql_data:/var/lib/mysql" \
    mysql:8.0 --default-authentication-plugin=mysql_native_password >/dev/null

  # Generate environment file
  cat > "$PUTMEIN_ENV_FILE" << EOF
# PutmeIn Local Environment
DATABASE_URL="mysql://root:${DB_PASSWORD}@127.0.0.1:${MYSQL_PORT}/putmein?allowPublicKeyRetrieval=true"
JWT_SECRET="${JWT_SECRET}"
RAY_PORT=4567
BRAIN_PORT=4500
RAY_URL="http://localhost:4567"
BRAIN_URL="http://localhost:4500"
NEXT_PUBLIC_BRAIN_URL="http://localhost:4500"
BRAIN_INTERNAL_SECRET="putmein-sec-$(head -c 8 /dev/urandom 2>/dev/null | xxd -p 2>/dev/null || date +%s)"
AGENT_AUTONOMOUS="false"
EOF
  chmod 600 "$PUTMEIN_ENV_FILE"
  success "Local database created and credentials saved to $PUTMEIN_ENV_FILE"

  # Wait for MySQL readiness
  printf "  %b⏳%b Waiting for database engine to accept connections..." "${CYAN}" "${NC}"
  for i in $(seq 1 30); do
    if docker exec "$MYSQL_CONTAINER" mysqladmin ping -h localhost -uroot -p"${DB_PASSWORD}" &>/dev/null; then
      break
    fi
    sleep 1
    printf "."
  done
  echo ""
  success "Database engine ready!"
fi

# Ensure database password is known and allowPublicKeyRetrieval is configured
if [ -f "$PUTMEIN_ENV_FILE" ]; then
  if [ -z "$DB_PASSWORD" ]; then
    DB_PASSWORD=$(grep "^DATABASE_URL=" "$PUTMEIN_ENV_FILE" 2>/dev/null | sed -E 's/.*:([^@]+)@.*/\1/' || true)
  fi
  if ! grep -q "allowPublicKeyRetrieval" "$PUTMEIN_ENV_FILE"; then
    sed -i.bak -E 's/(DATABASE_URL="mysql:\/\/[^"?]+)(\?.*)?"/\1\?allowPublicKeyRetrieval=true"/' "$PUTMEIN_ENV_FILE" 2>/dev/null || true
  fi
  # Ensure secure JWT_SECRET exists in existing env file
  if ! grep -q "^JWT_SECRET=" "$PUTMEIN_ENV_FILE" || grep -q "putmein-jwt-secret-default-key-2024" "$PUTMEIN_ENV_FILE"; then
    if command -v openssl &>/dev/null; then
      NEW_JWT_SECRET=$(openssl rand -hex 32)
    else
      NEW_JWT_SECRET=$(LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom 2>/dev/null | head -c 64 || date +%s%N)
    fi
    if grep -q "^JWT_SECRET=" "$PUTMEIN_ENV_FILE"; then
      sed -i.bak -E "s/^JWT_SECRET=.*/JWT_SECRET=\"${NEW_JWT_SECRET}\"/" "$PUTMEIN_ENV_FILE" 2>/dev/null || true
    else
      echo "JWT_SECRET=\"${NEW_JWT_SECRET}\"" >> "$PUTMEIN_ENV_FILE"
    fi
  fi
fi

# Ensure root user in MySQL container accepts native password for reliable adapter connectivity
docker exec -i "$MYSQL_CONTAINER" mysql -uroot -p"${DB_PASSWORD}" << EOSQL 2>/dev/null || true
ALTER USER 'root'@'%' IDENTIFIED WITH mysql_native_password BY '${DB_PASSWORD}';
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${DB_PASSWORD}';
FLUSH PRIVILEGES;
EOSQL

# Initialize database schema directly inside MySQL container (Zero external dependencies)
info "Initializing database tables and default admin account..."
docker exec -i "$MYSQL_CONTAINER" mysql -uroot -p"${DB_PASSWORD}" putmein << 'EOSQL' 2>/dev/null || true
CREATE TABLE IF NOT EXISTS `Post` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `excerpt` TEXT NULL,
  `coverImage` VARCHAR(191) NULL,
  `metaTitle` VARCHAR(191) NULL,
  `metaDescription` TEXT NULL,
  `metaKeywords` TEXT NULL,
  `isPublished` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Post_slug_key`(`slug`),
  INDEX `Post_slug_idx`(`slug`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `password` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL DEFAULT 'USER',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `users_email_key`(`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contacts` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `subject` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `waitlists` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(191) NOT NULL,
  `reason` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_chat_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL DEFAULT 'New Chat',
  `model` VARCHAR(191) NOT NULL DEFAULT 'MiniMax-M3',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ray_chat_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_chat_messages` (
  `id` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ray_chat_messages_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ray_chat_sessions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_monitor_projects` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `projectPath` TEXT NOT NULL,
  `logPaths` TEXT NOT NULL,
  `logCommand` TEXT NULL,
  `runCommand` TEXT NULL,
  `intervalSec` INT NOT NULL DEFAULT 30,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `status` VARCHAR(191) NOT NULL DEFAULT 'discovering',
  `memory` LONGTEXT NULL,
  `memoryStatus` VARCHAR(191) NULL,
  `projectUrl` TEXT NULL,
  `managedPid` INT NULL,
  `managedLogFile` TEXT NULL,
  `lastChecked` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ray_monitor_projects_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_monitor_alerts` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `severity` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `rawLog` LONGTEXT NOT NULL,
  `dismissed` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ray_monitor_alerts_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `ray_monitor_projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_deployments` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(191) NOT NULL,
  `repoUrl` TEXT NULL,
  `branch` VARCHAR(191) NULL DEFAULT 'main',
  `commitHash` VARCHAR(191) NULL,
  `commitMessage` TEXT NULL,
  `projectPath` TEXT NOT NULL,
  `dockerfile` LONGTEXT NULL,
  `containerId` VARCHAR(191) NULL,
  `containerName` VARCHAR(191) NULL,
  `imageName` VARCHAR(191) NULL,
  `hostPort` INT NULL,
  `containerPort` INT NULL DEFAULT 3000,
  `envVars` TEXT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `buildLogs` LONGTEXT NULL,
  `deployUrl` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ray_deployments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_github_integrations` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `githubUsername` VARCHAR(191) NULL,
  `accessToken` TEXT NULL,
  `avatarUrl` TEXT NULL,
  `webhookSecret` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ray_github_integrations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_pipelines` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `repoUrl` TEXT NOT NULL,
  `branch` VARCHAR(191) NOT NULL DEFAULT 'main',
  `autoDeploy` BOOLEAN NOT NULL DEFAULT true,
  `dockerfilePath` VARCHAR(191) NULL DEFAULT 'Dockerfile',
  `port` INT NOT NULL DEFAULT 3000,
  `status` VARCHAR(191) NOT NULL DEFAULT 'idle',
  `lastRunAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ray_pipelines_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_pipeline_runs` (
  `id` VARCHAR(191) NOT NULL,
  `pipelineId` VARCHAR(191) NOT NULL,
  `commitHash` VARCHAR(191) NULL,
  `commitMessage` TEXT NULL,
  `author` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'running',
  `stages` LONGTEXT NULL,
  `logs` LONGTEXT NULL,
  `durationMs` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ray_pipeline_runs_pipelineId_fkey` FOREIGN KEY (`pipelineId`) REFERENCES `ray_pipelines` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ray_security_scans` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NULL,
  `projectName` VARCHAR(191) NOT NULL,
  `trigger` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `dangerCount` INT NOT NULL DEFAULT 0,
  `warnCount` INT NOT NULL DEFAULT 0,
  `infoCount` INT NOT NULL DEFAULT 0,
  `findings` LONGTEXT NOT NULL,
  `logs` LONGTEXT NOT NULL,
  `overrideBy` VARCHAR(191) NULL,
  `overridden` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ray_security_scans_userId_idx`(`userId`),
  INDEX `ray_security_scans_projectId_idx`(`projectId`),
  CONSTRAINT `ray_security_scans_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

EOSQL
success "Database schema verified and ready for initial setup!"

# ==============================================================================
# Step 6: Install PutmeIn Global CLI & Launch PM2 Daemon
# ==============================================================================
step "6/6" "Installing PutmeIn Engine & Starting Services..."

# Remove old shims to guarantee zero conflicts
rm -f "$NPM_PREFIX/bin/ray" "$NPM_PREFIX/bin/putmein" "/usr/local/bin/ray" "/usr/local/bin/putmein" 2>/dev/null || true

info "Installing 'putmein' package from NPM..."
NPM_INSTALLED=false
for attempt in 1 2 3; do
  if npm install -g putmein@latest --force 2>/dev/null; then
    NPM_INSTALLED=true
    break
  elif [ "$(id -u)" -ne 0 ] && command -v sudo &>/dev/null; then
    if run_elevated npm install -g putmein@latest --force; then
      NPM_INSTALLED=true
      break
    fi
  fi
  if [ "$attempt" -lt 3 ]; then
    warn "NPM package replication or network sync in progress. Retrying in 4s (attempt $((attempt + 1))/3)..."
    sleep 4
  fi
done

if [ "$NPM_INSTALLED" = true ]; then
  success "PutmeIn CLI installed successfully!"
else
  warn "Retrying global install with detailed logging..."
  run_elevated npm install -g putmein@latest --force || {
    error "Failed to install 'putmein' from NPM. Please verify npm registry connection."
    exit 1
  }
  success "PutmeIn CLI installed successfully!"
fi

# Locate exact package directory
GLOBAL_NPM_ROOT=$(npm root -g 2>/dev/null || echo "/usr/local/lib/node_modules")
PUTMEIN_PKG_DIR="$GLOBAL_NPM_ROOT/putmein"

# Guarantee ray binary symlink is present and in PATH
if [ -f "$PUTMEIN_PKG_DIR/bin/ray.js" ]; then
  chmod +x "$PUTMEIN_PKG_DIR/bin/ray.js" 2>/dev/null || true
  ln -sf "$PUTMEIN_PKG_DIR/bin/ray.js" "$NPM_PREFIX/bin/ray" 2>/dev/null || true
  ln -sf "$PUTMEIN_PKG_DIR/bin/ray.js" /usr/local/bin/ray 2>/dev/null || true
fi

# Temporarily stop systemd PM2 auto-restart to prevent resurrecting stale processes
systemctl stop pm2-root 2>/dev/null || true
systemctl stop "pm2-$(whoami 2>/dev/null || echo root)" 2>/dev/null || true

# Reset PM2 daemon to guarantee clean process table and free ports
pm2 delete putmein-ray putmein-brain 2>/dev/null || true
pm2 delete all 2>/dev/null || true
pm2 kill 2>/dev/null || true
if command -v fuser &>/dev/null; then
  fuser -k 4567/tcp 4500/tcp 2>/dev/null || true
elif command -v lsof &>/dev/null; then
  lsof -ti:4567,4500 | xargs kill -9 2>/dev/null || true
fi

# Start services directly using fresh package ecosystem config
info "Starting PutmeIn background services (Ray & Brain)..."
if [ -f "$PUTMEIN_PKG_DIR/ecosystem.config.js" ]; then
  pm2 start "$PUTMEIN_PKG_DIR/ecosystem.config.js" --update-env || ray start || true
else
  ray restart 2>/dev/null || ray start || true
fi

# Persist fresh PM2 state to dump and re-enable system boot startup
pm2 save --force 2>/dev/null || true
ray starter 2>/dev/null || true
systemctl restart pm2-root 2>/dev/null || true

# Helper for perfectly aligned box borders
print_box_line() {
  local content="$1"
  local visible
  visible=$(echo -e "$content" | sed -E "s/\x1B\[[0-9;]*[a-zA-Z]//g")
  local len=${#visible}
  local pad=$(( 66 - len ))
  if [ $pad -lt 0 ]; then pad=0; fi
  printf "${BOLD}${CYAN}│${NC}  %b%*s  ${BOLD}${CYAN}│${NC}\n" "$content" "$pad" ""
}

# ==============================================================================
# Finish: Display Completion Box
# ==============================================================================
LAN_IP=$(get_lan_ip)
RAY_PORT="4567"
BRAIN_PORT="4500"
BOX_BORDER=$(printf '─%.0s' {1..70})

echo ""
echo -e "${BOLD}${CYAN}╭${BOX_BORDER}╮${NC}"
print_box_line ""
print_box_line "${BOLD}${GREEN}[OK] PutmeIn successfully installed and running!${NC}"
print_box_line ""
print_box_line "${BOLD}Web Dashboard (Ray):${NC}    ${CYAN}http://localhost:${RAY_PORT}${NC}"
print_box_line "${BOLD}Network Dashboard:${NC}      ${CYAN}http://${LAN_IP}:${RAY_PORT}${NC}"
print_box_line "${BOLD}AI Backend (Brain):${NC}     ${DIM}http://localhost:${BRAIN_PORT}${NC}"
print_box_line ""
print_box_line "${BOLD}First-Time Setup:${NC}"
print_box_line "  * Open Web Dashboard to configure your admin account"
print_box_line ""
print_box_line "${BOLD}Useful CLI Commands:${NC}"
print_box_line "  * ${YELLOW}ray status${NC}         Inspect service health and memory"
print_box_line "  * ${YELLOW}ray logs${NC}           Stream real-time unified logs"
print_box_line "  * ${YELLOW}ray stop${NC}           Stop running background services"
print_box_line "  * ${YELLOW}ray restart${NC}        Restart background services"
print_box_line "  * ${YELLOW}ray cohen${NC}          Launch interactive terminal TUI"
print_box_line "  * ${YELLOW}ray --no-startup${NC}   Disable launching on system boot"
print_box_line ""
echo -e "${BOLD}${CYAN}╰${BOX_BORDER}╯${NC}"
echo ""
