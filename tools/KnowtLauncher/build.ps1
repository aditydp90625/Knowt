$ErrorActionPreference = "Stop"

$launcherDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputDirectory = Join-Path $launcherDirectory "dist"
$compilerPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path -LiteralPath $compilerPath)) {
    throw "The Windows C# compiler was not found at $compilerPath"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
& $compilerPath /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /out:"$outputDirectory\Knowt.exe" "$launcherDirectory\Program.cs"
if ($LASTEXITCODE -ne 0) {
    throw "Knowt launcher compilation failed with exit code $LASTEXITCODE"
}

Write-Output (Join-Path $outputDirectory "Knowt.exe")
