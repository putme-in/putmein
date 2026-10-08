# ==============================================================================
# PutmeIn Windows Installation Script (PowerShell)
# Usage: irm https://putme.in/install.ps1 | iex
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

function Write-Color([string]$text, [ConsoleColor]$color) {
    Write-Host $text -ForegroundColor $color
}

function Write-Step([string]$step, [string]$title) {
    Write-Host ""
    Write-Host "[$step] " -ForegroundColor Cyan -NoNewline
    Write-Host $title -ForegroundColor White
}

function Write-Success([string]$msg) {
    Write-Host "  [OK] " -ForegroundColor Green -NoNewline
    Write-Host $msg -ForegroundColor White
}

function Write-WarnMsg([string]$msg) {
    Write-Host "  [WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $msg -ForegroundColor White
}

function Write-ErrorMsg([string]$msg) {
    Write-Host "  [ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $msg -ForegroundColor White
}

function Test-DockerRunning {
    try {
        $null = & docker info 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function New-RandomHex([int]$byteCount) {
    $bytes = New-Object byte[] $byteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return [System.BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
}

Write-Color "██████╗ ██╗   ██╗████████╗███╗   ███╗███████╗   ██╗███╗   ██╗" Cyan
Write-Color "██╔══██╗██║   ██║╚══██╔══╝████╗ ████║██╔════╝   ██║████╗  ██║" Cyan
Write-Color "██████╔╝██║   ██║   ██║   ██╔████╔██║█████╗     ██║██╔██╗ ██║" Cyan
Write-Color "██╔═══╝ ██║   ██║   ██║   ██║╚██╔╝██║██╔══╝     ██║██║╚██╗██║" Cyan
Write-Color "██║     ╚██████╔╝   ██║   ██║ ╚═╝ ██║███████╗██╗██║██║ ╚████║" Cyan
Write-Color "╚═╝      ╚═════╝    ╚═╝   ╚═╝     ╚═╝╚══════╝╚═╝╚═╝╚═╝  ╚═══╝" Cyan
Write-Host ""
Write-Color "Autonomous DevOps, Infrastructure Monitoring & Deployment Engine" White
Write-Color "Windows Installer - https://putme.in" DarkGray
Write-Host "------------------------------------------------------------------------" -ForegroundColor DarkGray

# ==============================================================================
# Step 1: Detect Windows Environment
# ==============================================================================
Write-Step "1/6" "Detecting System Environment..."
$arch = $env:PROCESSOR_ARCHITECTURE
Write-Success "Operating System: Windows ($arch)"

# ==============================================================================
# Step 2: Check Docker Engine
# ==============================================================================
Write-Step "2/6" "Checking Docker Engine..."
$hasDocker = Get-Command docker -ErrorAction SilentlyContinue

if ($hasDocker) {
    if (Test-DockerRunning) {
        $dockerVer = (& docker --version 2>&1)
        Write-Success "Docker is running ($dockerVer)"
    } else {
        $desktopPaths = @(
            "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
            "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
            "$env:LOCALAPPDATA\Programs\Docker Desktop\Docker Desktop.exe"
        )
        $desktopExe = $desktopPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

        if ($desktopExe) {
            Write-WarnMsg "Docker is installed but the Docker Desktop daemon is not active."
            Write-Color "  Attempting to launch Docker Desktop in background..." Cyan
            try {
                Start-Process $desktopExe
                Write-Host "  Waiting for Docker Desktop engine to initialize..." -ForegroundColor Cyan -NoNewline
                for ($i = 1; $i -le 20; $i++) {
                    Start-Sleep -Seconds 2
                    Write-Host "." -ForegroundColor Cyan -NoNewline
                    if (Test-DockerRunning) {
                        break
                    }
                }
                Write-Host ""
            } catch {}

            if (Test-DockerRunning) {
                Write-Success "Docker Desktop initialized successfully!"
            } else {
                Write-WarnMsg "Docker Desktop is still initializing. Continuing setup..."
            }
        } else {
            Write-WarnMsg "Docker is installed but the daemon is not running."
            Write-WarnMsg "Please launch Docker Desktop to enable local containerized databases."
        }
    }
} else {
    Write-WarnMsg "Docker was not found on your system."
    $hasWinget = Get-Command winget -ErrorAction SilentlyContinue
    if ($hasWinget) {
        Write-Color "  Installing Docker Desktop via winget..." Cyan
        winget install Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
        Write-Success "Docker Desktop installed. Please launch it and restart this installer if needed."
    } else {
        Write-WarnMsg "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/"
    }
}

# ==============================================================================
# Step 3: Check Node.js and NPM
# ==============================================================================
Write-Step "3/6" "Checking Node.js Environment..."
$hasNode = Get-Command node -ErrorAction SilentlyContinue
$needNode = $false

if ($hasNode) {
    $nodeVer = (node -v).TrimStart("v")
    $major = [int]($nodeVer.Split(".")[0])
    if ($major -lt 20) {
        Write-WarnMsg "Node.js version ($nodeVer) is too old. Requires >= 20."
        $needNode = $true
    } else {
        Write-Success "Node.js v$nodeVer is ready."
        Write-Success "NPM v$((npm -v)) is ready."
    }
} else {
    $needNode = $true
}

if ($needNode) {
    $hasWinget = Get-Command winget -ErrorAction SilentlyContinue
    if ($hasWinget) {
        Write-Color "  Installing Node.js LTS via winget..." Cyan
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        $env:Path = "$userPath;$env:Path"
        Write-Success "Node.js installed successfully!"
    } else {
        Write-ErrorMsg "Please install Node.js (LTS) from https://nodejs.org/"
        exit 1
    }
}

# ==============================================================================
# Step 4: Check PM2
# ==============================================================================
Write-Step "4/6" "Checking Process Manager (PM2)..."
$hasPm2 = Get-Command pm2 -ErrorAction SilentlyContinue

if ($hasPm2) {
    Write-Success "PM2 is ready ($((pm2 -v)))."
} else {
    Write-Color "  Installing PM2 globally..." Cyan
    npm install -g pm2
    Write-Success "PM2 installed globally!"
}

# ==============================================================================
# Step 5: Configure Local MySQL Database
# ==============================================================================
Write-Step "5/6" "Configuring Database & Environment..."
$configDir = Join-Path $env:USERPROFILE ".putmein"
if (!(Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

$envFile = Join-Path $configDir ".env"
$mysqlContainer = "putmein-mysql"
$mysqlPort = "3306"
$dbPassword = ""

# Reuse the password saved in an existing environment file so rerunning the
# installer keeps access to an existing database. Generate a cryptographically
# random password for fresh installations.
if (Test-Path $envFile) {
    $existingEnv = Get-Content -Path $envFile -Raw
    if ($existingEnv -match 'DATABASE_URL="mysql://root:([^@"]+)@') {
        $dbPassword = $Matches[1]
    }
}
if ([string]::IsNullOrEmpty($dbPassword)) {
    $dbPassword = New-RandomHex 32
}

if (Test-DockerRunning) {
    $existingContainers = @()
    try {
        $out = (& docker ps -a --format "{{.Names}}" 2>$null)
        if ($out) {
            $existingContainers = $out -split "`r?`n"
        }
    } catch {}

    if ($existingContainers -contains $mysqlContainer) {
        $runningContainers = @()
        try {
            $out = (& docker ps --format "{{.Names}}" 2>$null)
            if ($out) {
                $runningContainers = $out -split "`r?`n"
            }
        } catch {}

        if ($runningContainers -contains $mysqlContainer) {
            Write-Success "Persistent MySQL container ($mysqlContainer) is running."
        } else {
            & docker start $mysqlContainer 2>$null | Out-Null
            Write-Success "Started existing MySQL container."
        }
    } else {
        Write-Color "  Creating dedicated MySQL container on port $mysqlPort..." Cyan
        & docker run -d `
            --name $mysqlContainer `
            --restart unless-stopped `
            -p "127.0.0.1:${mysqlPort}:3306" `
            -e "MYSQL_ROOT_PASSWORD=$dbPassword" `
            -e "MYSQL_DATABASE=putmein" `
            -v "putmein_mysql_data:/var/lib/mysql" `
            mysql:8.0 --default-authentication-plugin=mysql_native_password 2>$null | Out-Null

        # Wait for MySQL readiness
        Write-Host "  Waiting for database engine to accept connections..." -ForegroundColor Cyan -NoNewline
        for ($i = 1; $i -le 30; $i++) {
            $ping = & docker exec $mysqlContainer mysqladmin ping -h localhost -uroot -p"$dbPassword" 2>$null
            if ($ping -match "alive") {
                break
            }
            Start-Sleep -Seconds 1
            Write-Host "." -ForegroundColor Cyan -NoNewline
        }
        Write-Host ""
        Write-Success "Database engine ready!"
    }
}

# Create environment configuration if missing or update with safe URL
if (!(Test-Path $envFile)) {
    $jwtBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
    $jwtSecret = [System.BitConverter]::ToString($jwtBytes).Replace("-", "").ToLower()

    $brainSecretBytes = New-Object byte[] 16
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($brainSecretBytes)
    $brainSecret = "putmein-sec-" + [System.BitConverter]::ToString($brainSecretBytes).Replace("-", "").ToLower()

    $envContent = @"
# PutmeIn Local Environment
DATABASE_URL="mysql://root:${dbPassword}@127.0.0.1:${mysqlPort}/putmein?allowPublicKeyRetrieval=true"
JWT_SECRET="$jwtSecret"
RAY_PORT=4567
BRAIN_PORT=4500
RAY_URL="http://localhost:4567"
BRAIN_URL="http://localhost:4500"
NEXT_PUBLIC_BRAIN_URL="http://localhost:4500"
BRAIN_INTERNAL_SECRET="$brainSecret"
AGENT_AUTONOMOUS="false"
"@
    Set-Content -Path $envFile -Value $envContent
    Write-Success "Configuration saved to $envFile"
} else {
    # Ensure existing env file has a secure JWT_SECRET
    $currentContent = Get-Content -Path $envFile -Raw
    if ($currentContent -notmatch "JWT_SECRET=" -or $currentContent -match "putmein-jwt-secret-default-key-2024") {
        $jwtBytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
        $newJwtSecret = [System.BitConverter]::ToString($jwtBytes).Replace("-", "").ToLower()
        if ($currentContent -match "JWT_SECRET=") {
            $updatedContent = $currentContent -replace "JWT_SECRET=.*", "JWT_SECRET=`"$newJwtSecret`""
        } else {
            $updatedContent = $currentContent.TrimEnd() + "`r`nJWT_SECRET=`"$newJwtSecret`"`r`n"
        }
        Set-Content -Path $envFile -Value $updatedContent
        Write-Success "Updated JWT_SECRET in $envFile"
    }
}

# ==============================================================================
# Step 6: Install PutmeIn Global Package & Launch
# ==============================================================================
Write-Step "6/6" "Installing PutmeIn Engine & Starting Services..."

Write-Color "  Installing PutmeIn package from NPM..." Cyan
$npmInstalled = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
    & npm install -g putmein@latest --force
    if ($LASTEXITCODE -eq 0) {
        $npmInstalled = $true
        break
    }
    if ($attempt -lt 3) {
        Write-WarnMsg "NPM package replication or network sync in progress. Retrying in 4s (attempt $($attempt + 1)/3)..."
        Start-Sleep -Seconds 4
    }
}

if ($npmInstalled) {
    Write-Success "PutmeIn CLI installed globally!"
} else {
    Write-ErrorMsg "Failed to install 'putmein' from NPM. Please verify your network connection."
    exit 1
}

# Refresh environment PATH for current session
$npmPrefix = (npm config get prefix 2>$null)
if ($npmPrefix) {
    $prefix = $npmPrefix.Trim()
    if ($env:Path -notlike "*$prefix*") {
        $env:Path = "$prefix;$env:Path"
    }
}
if ($env:APPDATA -and (Test-Path "$env:APPDATA\npm") -and ($env:Path -notlike "*$env:APPDATA\npm*")) {
    $env:Path = "$env:APPDATA\npm;$env:Path"
}

# If MySQL is running, initialize tables directly via SQL script
if (Test-DockerRunning) {
    try {
        $globalNpm = (npm root -g 2>$null)
        $sqlScriptPath = ""
        if ($globalNpm) {
            $candidate = Join-Path $globalNpm.Trim() "putmein\bin\init-db.sql"
            if (Test-Path $candidate) { $sqlScriptPath = $candidate }
        }
        if (-not $sqlScriptPath) {
            $candidate = "$env:APPDATA\npm\node_modules\putmein\bin\init-db.sql"
            if (Test-Path $candidate) { $sqlScriptPath = $candidate }
        }
        if ($sqlScriptPath -and (Test-Path $sqlScriptPath)) {
            Write-Color "  Initializing database schema..." Cyan
            Get-Content $sqlScriptPath | docker exec -i putmein-mysql mysql -uroot -p"$dbPassword" putmein 2>$null
            & docker exec -i putmein-mysql mysql -uroot -p"$dbPassword" -e "ALTER USER 'root'@'%' IDENTIFIED WITH mysql_native_password BY '$dbPassword'; FLUSH PRIVILEGES;" 2>$null
            Write-Success "Database schema verified and ready for initial setup!"
        }
    } catch {}
}

# Start services via ray CLI or node fallback
Write-Color "  Starting PutmeIn services (Ray & Brain)..." Cyan
$rayCmd = Get-Command ray -ErrorAction SilentlyContinue
if ($rayCmd) {
    ray start
} else {
    $globalNpm = (npm root -g 2>$null)
    $rayScript = ""
    if ($globalNpm) {
        $rayScript = Join-Path $globalNpm.Trim() "putmein\bin\ray.js"
    }
    if ($rayScript -and (Test-Path $rayScript)) {
        node $rayScript start
    } else {
        node "$env:APPDATA\npm\node_modules\putmein\bin\ray.js" start
    }
}

# Output Finish (Pure ASCII borders for 100% cross-terminal fidelity)
function Write-BoxLine([string]$content = "", [ConsoleColor]$color = [ConsoleColor]::White) {
    $innerWidth = 66
    $len = $content.Length
    $pad = [Math]::Max(0, $innerWidth - $len)
    $spaces = " " * $pad
    Write-Host "|" -ForegroundColor Cyan -NoNewline
    Write-Host "  " -NoNewline
    if ($content.Length -gt 0) {
        Write-Host $content -ForegroundColor $color -NoNewline
    }
    Write-Host "$spaces  " -NoNewline
    Write-Host "|" -ForegroundColor Cyan
}

$boxBorder = "-" * 70
Write-Host ""
Write-Host "+$boxBorder+" -ForegroundColor Cyan
Write-BoxLine ""
Write-BoxLine "[OK] PutmeIn successfully installed and running!" -color Green
Write-BoxLine ""
Write-BoxLine "Web Dashboard (Ray):    http://localhost:4567"
Write-BoxLine "Network Dashboard:      http://127.0.0.1:4567"
Write-BoxLine "AI Backend (Brain):     http://localhost:4500"
Write-BoxLine ""
Write-BoxLine "First-Time Setup:"
Write-BoxLine "  * Open Web Dashboard to configure your admin account" -color Yellow
Write-BoxLine ""
Write-BoxLine "Useful CLI Commands:"
Write-BoxLine "  * ray status         Inspect service health and memory" -color Yellow
Write-BoxLine "  * ray logs           Stream real-time unified logs" -color Yellow
Write-BoxLine "  * ray stop           Stop running background services" -color Yellow
Write-BoxLine "  * ray restart        Restart background services" -color Yellow
Write-BoxLine "  * ray cohen          Launch interactive terminal TUI" -color Yellow
Write-BoxLine "  * ray --no-startup   Disable launching on system boot" -color Yellow
Write-BoxLine ""
Write-Host "+$boxBorder+" -ForegroundColor Cyan
Write-Host ""
