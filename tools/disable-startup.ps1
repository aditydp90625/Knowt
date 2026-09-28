[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Knowt.lnk"
if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Host "Knowt automatic startup disabled."
} else {
  Write-Host "Knowt automatic startup was not enabled."
}
