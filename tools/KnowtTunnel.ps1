[CmdletBinding()]
param(
    [ValidateSet("quickstart", "doctor", "run")]
    [string]$Action = "run",

    [string]$TunnelId = $env:KNOWT_TUNNEL_ID,

    [string]$McpServerUrl = $env:KNOWT_MCP_SERVER_URL,

    [string]$TunnelClientPath = $env:KNOWT_TUNNEL_CLIENT_PATH,

    [switch]$SkipKnowtHealthCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($McpServerUrl)) {
    $McpServerUrl = "http://127.0.0.1:4318/mcp"
}

function Resolve-TunnelClient {
    if (-not [string]::IsNullOrWhiteSpace($TunnelClientPath)) {
        if (-not (Test-Path -LiteralPath $TunnelClientPath -PathType Leaf)) {
            throw "KNOWT_TUNNEL_CLIENT_PATH does not point to a file: $TunnelClientPath"
        }
        return (Resolve-Path -LiteralPath $TunnelClientPath).Path
    }

    $command = Get-Command tunnel-client -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "tunnel-client was not found. Install it from OpenAI Platform tunnel settings, add it to PATH, or set KNOWT_TUNNEL_CLIENT_PATH to tunnel-client.exe."
    }
    return $command.Source
}

function Assert-KnowtHealthy {
    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:4318/api/health" -TimeoutSec 3
    }
    catch {
        throw "Knowt is not reachable at http://127.0.0.1:4318. Start Knowt before running the tunnel. $($_.Exception.Message)"
    }

    if ($health.status -ne "ok") {
        throw "Knowt returned an unexpected health response."
    }
}

$client = Resolve-TunnelClient

if ($Action -eq "quickstart") {
    & $client help quickstart
    exit $LASTEXITCODE
}

if ([string]::IsNullOrWhiteSpace($TunnelId)) {
    throw "Set KNOWT_TUNNEL_ID to the tunnel_... identifier from OpenAI Platform tunnel settings."
}

if ([string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY)) {
    throw "Set CONTROL_PLANE_API_KEY in this process environment. Do not save the runtime key in the repository or ChatGPT instructions."
}

if (-not $SkipKnowtHealthCheck) {
    Assert-KnowtHealthy
}

$arguments = @(
    $Action
    "--control-plane.tunnel-id=$TunnelId"
    "--mcp.server-url=$McpServerUrl"
)
if ($Action -eq "doctor") {
    $arguments += "--explain"
}

Write-Host "Starting tunnel-client '$Action' for Knowt at $McpServerUrl"
& $client @arguments
if ($LASTEXITCODE -ne 0) {
    throw "tunnel-client $Action failed with exit code $LASTEXITCODE."
}
