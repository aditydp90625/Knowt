[CmdletBinding()]
param([switch]$ForceInstall)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

function Require-Command([string]$name, [string]$installHint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name was not found. $installHint"
  }
}

function Require-Version([string]$name, [string]$versionText, [int]$minimumMajor, [string]$installHint) {
  $match = [regex]::Match($versionText, '(\d+)\.(\d+)(?:\.(\d+))?')
  if (-not $match.Success -or [int]$match.Groups[1].Value -lt $minimumMajor) {
    throw "$name $versionText was found, but version $minimumMajor or newer is required. $installHint"
  }
}

Require-Command "git" "Install Git for Windows from https://git-scm.com/download/win."
Require-Command "node" "Install Node.js 24 LTS or newer from https://nodejs.org/."
Require-Version "Node.js" (& node --version) 24 "Install Node.js 24 LTS or newer."

$packageManager = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).packageManager
$pnpmCommand = "pnpm"
$pnpmArguments = @()
if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
  if (Get-Command "corepack.cmd" -ErrorAction SilentlyContinue) {
    $pnpmCommand = "corepack.cmd"
    $pnpmArguments = @("pnpm")
  } elseif (Get-Command "npm.cmd" -ErrorAction SilentlyContinue) {
    $pnpmCommand = "npm.cmd"
    $pnpmArguments = @("exec", "--yes", "--package=$packageManager", "--", "pnpm")
  } else {
    throw "pnpm was not found, and neither Corepack nor npm is available. Install $packageManager and run setup again."
  }
  Write-Host "pnpm is not on PATH. Using $pnpmCommand to run $packageManager."
}
$pnpmVersion = & $pnpmCommand @pnpmArguments --version
if ($LASTEXITCODE -ne 0) { throw "Could not run $packageManager using $pnpmCommand. Check the download error above and run setup again." }
Require-Version "pnpm" ($pnpmVersion -join "`n") 11 "Install pnpm 11 or newer."

Write-Host "Required tools found."
Write-Host "Repository: $root"
Write-Host "Private data: $env:LOCALAPPDATA\Knowt\data"

if ($ForceInstall -or -not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Host "Installing dependencies..."
  & $pnpmCommand @pnpmArguments install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE." }
}

function Run-Checked([string]$file, [string[]]$arguments) {
  & $file @arguments
  if ($LASTEXITCODE -ne 0) { throw "$file failed with exit code $LASTEXITCODE." }
}

Write-Host "Building Knowt..."
Run-Checked "node" @("node_modules/typescript/bin/tsc", "-p", "packages/contracts/tsconfig.json")
Run-Checked "node" @("node_modules/typescript/bin/tsc", "-p", "apps/server/tsconfig.json")
Run-Checked "node" @("node_modules/typescript/bin/tsc", "-b", "apps/web/tsconfig.json", "--pretty", "false")
$webDirectory = Join-Path $root "apps/web"
Push-Location $webDirectory
try { Run-Checked (Join-Path $webDirectory "node_modules/.bin/vite.cmd") @("build", "--config", "vite.config.ts") }
finally { Pop-Location }

Write-Host "Setup complete. Start Knowt with: pnpm beta:start"
