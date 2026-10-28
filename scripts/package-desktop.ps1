# Windows entry point of scripts/package-desktop.sh: builds the desktop bundle (activiti-modeler-<version>-windows-x64.zip in dist-desktop\).
#   powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1 [-Jar <jar>] [-Version <x.y.z>] [-Out <folder>]
# The packaging logic lives in the bash script so that all operating systems share it; it runs under Git Bash, which comes with Git for Windows
# (and is on the GitHub Actions Windows runners). A JDK 25 with jlink and jpackage must be on the PATH (build.cmd installs one into .tools\jdk-25).
param(
    [string]$Jar,
    [string]$Version,
    [string]$Out
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

$bash = (Get-Command bash -ErrorAction SilentlyContinue).Source
if (-not $bash) {
    foreach ($candidate in @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe", "$env:LocalAppData\Programs\Git\bin\bash.exe")) {
        if (Test-Path $candidate) { $bash = $candidate; break }
    }
}
if (-not $bash) { throw 'Git Bash was not found. Install Git for Windows (https://git-scm.com/download/win), then run this again.' }

# put the JDK that setup-jdk.ps1 installed (if any) on the PATH
$jdk = Join-Path $Root '.tools\jdk-25'
if (Test-Path (Join-Path $jdk 'bin\java.exe')) { $env:JAVA_HOME = $jdk; $env:PATH = "$jdk\bin;$env:PATH" }

$arguments = @("$Root\scripts\package-desktop.sh".Replace('\', '/'))
if ($Jar) { $arguments += @('--jar', $Jar.Replace('\', '/')) }
if ($Version) { $arguments += @('--version', $Version) }
if ($Out) { $arguments += @('--out', $Out.Replace('\', '/')) }
& $bash @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
