# shellcheck shell=bash
# Source this file (do not run it) to put the project-local JDK on JAVA_HOME and PATH:
#   source scripts/env.sh                      # JDK 25 (.tools/jdk-25): the main target, Activiti 9.0.0
#   ACTIVITI_LINE=8 source scripts/env.sh      # JDK 21 (.tools/jdk-21): the second target, Activiti 8.8.1 (build with -Pactiviti8)
# Does nothing when scripts/setup-jdk.sh has not installed the JDK (ACTIVITI_LINE=8 scripts/setup-jdk.sh for 21).
# BASH_SOURCE is empty in zsh (the default shell on macOS): zsh names the sourced file with %x
if [ -n "${ZSH_VERSION:-}" ]; then eval '_activiti_modeler_src="${(%):-%x}"'; else _activiti_modeler_src="${BASH_SOURCE[0]}"; fi
_activiti_modeler_root="$(cd "$(dirname "$_activiti_modeler_src")/.." && pwd)"
case "${ACTIVITI_LINE:-}" in
  8) _activiti_modeler_jdk=21 ;;
  *) _activiti_modeler_jdk=25 ;;
esac
if [ -x "$_activiti_modeler_root/.tools/jdk-$_activiti_modeler_jdk/bin/java" ]; then
  export JAVA_HOME="$_activiti_modeler_root/.tools/jdk-$_activiti_modeler_jdk"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
unset _activiti_modeler_src _activiti_modeler_root _activiti_modeler_jdk
