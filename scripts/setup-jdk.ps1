# Windows counterpart of scripts/setup-jdk.sh: makes sure a JDK 25 or newer is available.
# If `java` on the PATH is already 25 or newer nothing is downloaded; otherwise Eclipse Temurin 25 is downloaded into .tools\jdk-25.
# Dot-source it or run it; afterwards $env:JAVA_HOME and $env:PATH point at the JDK in this PowerShell session.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar
$Required = 25
$Root = Split-Path -Parent $PSScriptRoot
$JdkDir = Join-Path $Root ".tools\jdk-$Required"

function Get-JavaMajor([string]$JavaExe) {
    try {
        $text = (& $JavaExe -version 2>&1 | Out-String)
        if ($text -match 'version "(\d+)(?:\.(\d+))?') {
            if ($Matches[1] -eq '1') { return [int]$Matches[2] }
            return [int]$Matches[1]
        }
    } catch { }
    return 0
}

$local = Join-Path $JdkDir 'bin\java.exe'
if ((Test-Path $local) -and ((Get-JavaMajor $local) -ge $Required)) {
    Write-Host "Found the local JDK in $JdkDir"
} else {
    $onPath = Get-Command java -ErrorAction SilentlyContinue
    if ($onPath -and ((Get-JavaMajor $onPath.Source) -ge $Required)) {
        Write-Host "java on the PATH is already JDK $(Get-JavaMajor $onPath.Source); nothing to install."
        $JdkDir = $null
    } else {
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x64' }
        $url = "https://api.adoptium.net/v3/binary/latest/$Required/ga/windows/$arch/jdk/hotspot/normal/eclipse"
        $work = Join-Path $Root ".tools\jdk-download"
        if (Test-Path $work) { Remove-Item -Recurse -Force $work }
        New-Item -ItemType Directory -Force -Path $work | Out-Null
        Write-Host "Downloading Temurin $Required (windows/$arch) from $url"
        Invoke-WebRequest -Uri $url -OutFile (Join-Path $work 'jdk.zip') -UseBasicParsing
        Expand-Archive -Path (Join-Path $work 'jdk.zip') -DestinationPath (Join-Path $work 'extracted') -Force
        $home1 = Get-ChildItem -Path (Join-Path $work 'extracted') -Directory | Select-Object -First 1
        if (-not $home1 -or -not (Test-Path (Join-Path $home1.FullName 'bin\java.exe'))) { throw 'The downloaded archive does not contain a JDK.' }
        if (Test-Path $JdkDir) { Remove-Item -Recurse -Force $JdkDir }
        Move-Item -Path $home1.FullName -Destination $JdkDir
        Remove-Item -Recurse -Force $work
        if ((Get-JavaMajor (Join-Path $JdkDir 'bin\java.exe')) -lt $Required) { throw "Installed JDK is older than $Required." }
    }
}
if ($JdkDir) {
    $env:JAVA_HOME = $JdkDir
    $env:PATH = "$JdkDir\bin;$env:PATH"
} elseif ($env:JAVA_HOME -and ((Get-JavaMajor (Join-Path $env:JAVA_HOME 'bin\java.exe')) -lt $Required)) {
    Remove-Item Env:\JAVA_HOME   # an older JAVA_HOME would win over the java on the PATH inside the Maven wrapper
}
