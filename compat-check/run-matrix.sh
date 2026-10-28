#!/usr/bin/env bash
# Runs the compatibility test against the supported (stable) Activiti / Spring Boot combinations, each on its own JDK:
#   Activiti 9.0.0 (main target):    JDK 25 or newer
#   Activiti 8.8.1 (second target):  JDK 21
# A JDK is looked for in <repo>/.tools/jdk-<major> (scripts/setup-jdk.sh, ACTIVITI_LINE=8 for 21), then in JAVA_HOME_<major>_X64 /
# JAVA_HOME_<major>_ARM64 (GitHub runners), then in JAVA_HOME and `java` on the PATH (25: that version or newer; otherwise exactly it).
#
#   ./run-matrix.sh                  every combination; the 9.0.0 rows need JDK 25 (FAIL without), the 8.8.1 row is reported SKIP when no
#                                    JDK 21 is found (the main CI job has JDK 25 only on some machines)
#   ACTIVITI_LINE=8 ./run-matrix.sh  only the Activiti 8.8.1 combination; a missing JDK 21 is a FAIL
#   ACTIVITI_LINE=9 ./run-matrix.sh  only the Activiti 9.0.0 combinations; a missing JDK 25 is a FAIL
set -u
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

# activiti  boot  jdk
combos=(
  "9.0.0  3.5.16  25"
  "9.0.0  3.5.7   25"
  "8.8.1  3.5.7   21"
)

# Prints the major version of a JDK home, or 0.
home_major() {
  local v
  v="$("$1/bin/java" -version 2>&1 | awk -F'"' '/ version "/ { print $2; exit }')" || true
  case "$v" in 1.*) v="${v#1.}" ;; esac
  v="${v%%[^0-9]*}"
  echo "${v:-0}"
}

# Whether the JDK home $1 serves the wanted major $2 (25 means 25 or newer, any other value exactly that).
jdk_serves() {
  local m
  [ -x "$1/bin/java" ] || return 1
  m="$(home_major "$1")"
  [ "$m" -eq "$2" ] || { [ "$2" -eq 25 ] && [ "$m" -gt 25 ]; }
}

# Prints the JDK home for the wanted major, or nothing.
find_jdk() {
  local want="$1" candidate var path_java
  for candidate in "$ROOT/.tools/jdk-$want"; do
    if jdk_serves "$candidate" "$want"; then echo "$candidate"; return 0; fi
  done
  for var in "JAVA_HOME_${want}_X64" "JAVA_HOME_${want}_ARM64"; do
    candidate="${!var:-}"
    if [ -n "$candidate" ] && jdk_serves "$candidate" "$want"; then echo "$candidate"; return 0; fi
  done
  if [ -n "${JAVA_HOME:-}" ] && jdk_serves "$JAVA_HOME" "$want"; then echo "$JAVA_HOME"; return 0; fi
  if path_java="$(command -v java 2>/dev/null)"; then
    candidate="$(cd "$(dirname "$(readlink -f "$path_java")")/.." && pwd)"
    if jdk_serves "$candidate" "$want"; then echo "$candidate"; return 0; fi
  fi
  return 0
}

status=0
for combo in "${combos[@]}"; do
  read -r activiti boot jdk <<<"$combo"
  case "${ACTIVITI_LINE:-}" in
    8) [ "$activiti" = "8.8.1" ] || continue; strict=1 ;;
    9) [ "$activiti" = "9.0.0" ] || continue; strict=1 ;;
    *) if [ "$jdk" -eq 25 ]; then strict=1; else strict=0; fi ;;  # the main target is never skipped
  esac
  home="$(find_jdk "$jdk")"
  if [ -z "$home" ]; then
    if [ "$strict" -eq 1 ]; then result=FAIL; status=1; else result=SKIP; fi
    printf '%-4s activiti=%-6s boot=%-6s jdk=%s: no JDK %s found (install: %sscripts/setup-jdk.sh)\n' \
      "$result" "$activiti" "$boot" "$jdk" "$jdk" "$([ "$jdk" -eq 21 ] && echo 'ACTIVITI_LINE=8 ' || true)"
    continue
  fi
  if JAVA_HOME="$home" PATH="$home/bin:$PATH" mvn -B -q clean verify -Dactiviti.version="$activiti" -Dspring-boot.version="$boot" >/dev/null 2>&1; then
    result=PASS
  else
    result=FAIL
    status=1
  fi
  printf '%-4s activiti=%-6s boot=%-6s jdk=%s\n' "$result" "$activiti" "$boot" "$jdk"
done
exit $status
