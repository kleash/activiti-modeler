@echo off
rem Starts the Activiti Modeler that build.cmd built. Arguments go to the server, for example:
rem   run.cmd                              projects in %USERPROFILE%\ActivitiModeler\workspace, port 8080 (or a free one), the browser opens
rem   run.cmd --workspace=my-projects --no-open
setlocal EnableDelayedExpansion
set "ROOT=%~dp0"
set "JAR="
for %%F in ("%ROOT%java\activiti-modeler-server\target\activiti-modeler-server-*-exec.jar") do set "JAR=%%F"
if "%JAR%"=="" (
  echo Nothing to run yet: build the modeler first with build.cmd
  exit /b 1
)
set "JAVA=java"
if exist "%ROOT%.tools\jdk-25\bin\java.exe" set "JAVA=%ROOT%.tools\jdk-25\bin\java.exe"
"%JAVA%" -jar "%JAR%" %*
endlocal
