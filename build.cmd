@echo off
rem Builds the Activiti Modeler from source with one command (Windows). You need git; no Maven, no Node, and no particular Java:
rem   1. JDK 25: used when java is already 25 or newer, otherwise Eclipse Temurin 25 is downloaded into .tools\jdk-25 (scripts\setup-jdk.ps1)
rem   2. the Maven wrapper downloads Maven, its frontend plugin downloads Node 22 and builds the web app, and Maven builds the jar
rem Result: java\activiti-modeler-server\target\activiti-modeler-server-<version>-exec.jar. Start it with run.cmd.
rem   build.cmd [--with-tests] [maven arguments...]
setlocal
set "ROOT=%~dp0"
set "SKIP=-DskipTests"
set "EXTRA="
:args
if "%~1"=="" goto run
if /i "%~1"=="--with-tests" (set "SKIP=") else (set "EXTRA=%EXTRA% %1")
shift
goto args
:run
cd /d "%ROOT%"
echo ==^> JDK 25
rem the PowerShell script sets JAVA_HOME and PATH for its own session only, so it prints JAVA_HOME (empty: use java from the PATH) for this one
set "SETUP_OK="
for /f "usebackq tokens=1,* delims==" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . '%ROOT%scripts\setup-jdk.ps1' | Out-Null; Write-Output ('JAVA_HOME=' + $env:JAVA_HOME) }"`) do (
  if "%%A"=="JAVA_HOME" (
    set "SETUP_OK=1"
    set "JAVA_HOME=%%B"
  )
)
if not defined SETUP_OK (
  echo Could not set up JDK 25. Install a JDK 25 yourself and run build.cmd again.
  exit /b 1
)
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"
java -version 2>&1 | findstr /i "version"
echo ==^> Building the web app and the server jar (the first build downloads Maven, Node and the libraries: a few minutes)
call "%ROOT%java\mvnw.cmd" -f "%ROOT%java\pom.xml" -B -Pbundle-modeler -pl activiti-modeler-server -am package %SKIP% %EXTRA%
if errorlevel 1 exit /b 1
echo.
echo Built. Start it with:  run.cmd
endlocal
