$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$release = Join-Path $env:TEMP ("Knowt-release-" + [guid]::NewGuid().ToString("N"))
$zip = Join-Path $root "tmp\Knowt-windows-x64.zip"
$nodeVersion = "24.20.0"
$nodeArchiveName = "node-v$nodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeArchiveName"
$nodeSha256 = "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba"
$downloadDirectory = Join-Path $root "tmp\downloads"
$nodeArchive = Join-Path $downloadDirectory $nodeArchiveName
$nodeExtract = Join-Path $downloadDirectory "node-v$nodeVersion-win-x64"
if (Test-Path $zip) { Remove-Item -Force $zip }
New-Item -ItemType Directory -Force -Path $release | Out-Null
Push-Location $root
try {
  pnpm build
  $env:CI = "true"
  $env:PNPM_CONFIG_CONFIRM_MODULES_PURGE = "false"
  $env:npm_config_yes = "true"
  pnpm --filter @knowt/server deploy --prod --legacy --config.confirmModulesPurge=false (Join-Path $release "app")
  if ($LASTEXITCODE -ne 0) { throw "The server dependency deployment failed with exit code $LASTEXITCODE." }
  $copiedData = Join-Path $release "app\data"
  if (Test-Path $copiedData) { Remove-Item -Recurse -Force $copiedData }
  New-Item -ItemType Directory -Force -Path (Join-Path $release "app\web") | Out-Null
  Copy-Item -Recurse -Force (Join-Path $root "apps\web\dist") (Join-Path $release "app\web\dist")
  New-Item -ItemType Directory -Force -Path $downloadDirectory | Out-Null
  if (-not (Test-Path $nodeArchive)) {
    Write-Host "Downloading Node.js v$nodeVersion..."
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeArchive
  }
  $actualNodeSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $nodeArchive).Hash.ToLowerInvariant()
  if ($actualNodeSha256 -ne $nodeSha256) { throw "Node.js archive checksum mismatch. Expected $nodeSha256, got $actualNodeSha256." }
  if (Test-Path $nodeExtract) { Remove-Item -Recurse -Force $nodeExtract }
  Expand-Archive -LiteralPath $nodeArchive -DestinationPath $downloadDirectory
  New-Item -ItemType Directory -Force -Path (Join-Path $release "runtime") | Out-Null
  Copy-Item -Force (Join-Path $nodeExtract "node.exe") (Join-Path $release "runtime\node.exe")
  Copy-Item -Force (Join-Path $nodeExtract "LICENSE") (Join-Path $release "runtime\Node-LICENSE.txt")
  pnpm launcher:build
  New-Item -ItemType Directory -Force -Path (Join-Path $release "app") | Out-Null
  Copy-Item -Force (Join-Path $root "tools\KnowtLauncher\dist\Knowt.exe") (Join-Path $release "Knowt.exe")
  Copy-Item -Force (Join-Path $root "README.md") (Join-Path $release "README.txt")
  Copy-Item -Force (Join-Path $root "docs\user-installation.md") (Join-Path $release "INSTALLATION.txt")
  $forbidden = Get-ChildItem -Recurse -Force $release | Where-Object { $_.Name -match 'knowt\.sqlite|\.env|\.sqlite-wal|\.sqlite-shm|\.codex|attachments|node_modules\\\.bin' }
  if ($forbidden) { throw "Release contains private or forbidden files: $($forbidden.FullName -join ', ')" }
  Compress-Archive -Path (Join-Path $release '*') -DestinationPath $zip
  Write-Output $zip
}
finally { Pop-Location }
