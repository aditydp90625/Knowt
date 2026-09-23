[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$entryPoint = Join-Path $root "apps\server\dist\index.js"
if (-not (Test-Path $entryPoint)) {
  throw "The production build is missing. Run .\tools\setup-beta.ps1 first."
}

$healthUrl = "http://127.0.0.1:4318/api/health"
try { Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 | Out-Null }
catch {
  $server = Start-Process -FilePath "node" -ArgumentList @('"' + $entryPoint + '"') -WorkingDirectory $root -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 250
    try { Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 | Out-Null; break } catch { }
    if ($server.HasExited) { throw "Knowt stopped during startup. Check that Node.js is installed and port 4318 is available." }
  } while ((Get-Date) -lt $deadline)
  try { Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 | Out-Null }
  catch { throw "Knowt did not become ready within 20 seconds. Port 4318 may already be in use." }
}

Start-Process "http://127.0.0.1:4318"
Write-Host "Knowt is running at http://127.0.0.1:4318"
Write-Host "To stop it, close the node process or use: Get-Process node | Stop-Process"
