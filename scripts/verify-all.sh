#!/usr/bin/env bash
# Runs every check that exists, in order, and stops at the first failure:
#   1. toolchain  2. Java build and tests (hand-written seed corpus)  3. compat-check matrix
#   4. npm install  5. typecheck + lint  6. unit tests  7. build  8. Playwright UI tests
#   9. lint over the corpus seeds  10. corpus builds through the modeler, through its test API and (C01, C02, C04, C08, C11, C16,
#   C20-loan) through its real UI (+ completeness check)
#   11. harness over the MODELER-GENERATED corpus (the headline proof: generated models pass the hand-written scenarios)
# CI runs this same script. Needs JDK 25 (scripts/setup-jdk.sh), Maven, Node 22 and a Playwright Chromium.
# Set SKIP_COMPAT_CHECK=1 to skip the Activiti x Spring Boot compatibility matrix (it takes a minute or two).
# Set BOOT_VERSION=3.5.7 (for example) to run the Java steps against another Spring Boot 3.5.x version.
# Set ACTIVITI_LINE=8 to run the second target, Activiti 8.8.1 on JDK 21 (ADR 0002): every Maven call gets -Pactiviti8 and the
# toolchain check asks for JDK 21 or newer instead of 25. Install the JDK with ACTIVITI_LINE=8 scripts/setup-jdk.sh; Spring Boot 3.5.7
# is Activiti 8.8.1's own baseline: ACTIVITI_LINE=8 BOOT_VERSION=3.5.7 scripts/verify-all.sh. The npm sections are the same, except
# section 8 (Playwright): it tests the modeler app and the modeler server jar, which ship on Activiti 9.0.0 / JDK 25 (ADR 0002, revision
# 2026-10-27) and whose e2e specs expect that version, so the 8.8.1 run leaves it to the main job. It still needs Chromium: the corpus builds (section 10) drive the modeler in it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env.sh
source "$ROOT/scripts/env.sh"

SECTION="start"
section() {
  SECTION="$*"
  printf '\n========== %s ==========\n' "$SECTION"
}
on_exit() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    printf '\n!!!!!!!!!! verify-all FAILED in section: %s (exit %s) !!!!!!!!!!\n' "$SECTION" "$status" >&2
  fi
}
trap on_exit EXIT

MVN_BOOT=()
if [ -n "${BOOT_VERSION:-}" ]; then MVN_BOOT=("-Dspring-boot.version=$BOOT_VERSION"); fi
MIN_JDK=25
ENGINE_LABEL="Activiti 9.0.0"
if [ "${ACTIVITI_LINE:-}" = "8" ]; then
  MVN_BOOT+=("-Pactiviti8")
  MIN_JDK=21
  ENGINE_LABEL="Activiti 8.8.1"
fi

section "1/11 Toolchain"
command -v java >/dev/null || { echo "java not found. Run scripts/setup-jdk.sh" >&2; exit 1; }
java -version
java_major="$(java -version 2>&1 | awk -F'"' '/ version "/ { split($2, v, "."); print v[1]; exit }')"
if [ "${java_major:-0}" -lt "$MIN_JDK" ]; then
  if [ "$MIN_JDK" -eq 21 ]; then
    echo "JDK 21 or newer is required for $ENGINE_LABEL (ACTIVITI_LINE=8), found ${java_major:-unknown}. Run: ACTIVITI_LINE=8 scripts/setup-jdk.sh, then: ACTIVITI_LINE=8 source scripts/env.sh" >&2
  else
    echo "JDK 25 or newer is required, found ${java_major:-unknown}. Run scripts/setup-jdk.sh, then: source scripts/env.sh" >&2
  fi
  exit 1
fi
echo "target: $ENGINE_LABEL, JDK $java_major (minimum $MIN_JDK)"
mvn -v
echo "node $(node -v), npm $(npm -v)"

section "2/11 Java: build and unit tests (mvn verify, $ENGINE_LABEL, Spring Boot ${BOOT_VERSION:-default})"
# clean, so a stale target/corpus from an earlier run cannot stand in for this run's generated corpus
mvn -B -f "$ROOT/java/pom.xml" ${MVN_BOOT[@]+"${MVN_BOOT[@]}"} clean verify

section "3/11 compat-check: Activiti x Spring Boot matrix"
if [ "${SKIP_COMPAT_CHECK:-0}" = "1" ]; then
  echo "Skipped (SKIP_COMPAT_CHECK=1)"
else
  "$ROOT/compat-check/run-matrix.sh"
fi

cd "$ROOT/modeler"

section "4/11 Modeler: npm ci"
npm ci

section "5/11 Modeler: typecheck and lint"
npm run typecheck
npm run lint

section "6/11 Modeler: unit tests (Vitest)"
npm test

section "7/11 Modeler: build"
npm run build

section "8/11 Modeler: Playwright UI tests"
if [ "${ACTIVITI_LINE:-}" = "8" ]; then
  echo "Skipped (ACTIVITI_LINE=8): the modeler app and the modeler server ship on Activiti 9.0.0 and are tested by the main run"
else
  npm run e2e
fi

section "9/11 Lint over the corpus seeds"
npm run lint:corpus

section "10/11 Corpus builds through the modeler (test API and real UI)"
npm run corpus:build
GENERATED="$ROOT/java/verification-harness/target/corpus"
UI_GENERATED="$ROOT/java/verification-harness/target/corpus-ui"
missing=0
expected_ids=()
ui_ids=()
for build in "$ROOT"/corpus/*/build.ts; do
  id="$(basename "$(dirname "$build")")"
  expected_ids+=("$id")
  if ! ls "$GENERATED/$id/processes/"*.bpmn20.xml >/dev/null 2>&1; then
    echo "corpus/$id/build.ts produced no processes in $GENERATED/$id" >&2
    missing=1
  fi
  # a build that also runs through the UI says so (export const uiDriven = true)
  if grep -q '^export const uiDriven = true;' "$build"; then
    ui_ids+=("$id")
    if ! ls "$UI_GENERATED/$id/processes/"*.bpmn20.xml >/dev/null 2>&1; then
      echo "corpus/$id/build.ts produced no processes through the UI in $UI_GENERATED/$id" >&2
      missing=1
    fi
  fi
done
[ "$missing" -eq 0 ] || exit 1
echo "generated projects: ${expected_ids[*]}"
echo "built through the UI: ${ui_ids[*]}"

section "11/11 Harness over the modeler-generated corpus"
cd "$ROOT"
harness_log="$(mktemp)"
mvn -B -f "$ROOT/java/pom.xml" ${MVN_BOOT[@]+"${MVN_BOOT[@]}"} -pl activiti-scenario-runner,verification-harness -am verify | tee "$harness_log"
check_runs() {
  local origin="$1"
  shift
  for id in "$@"; do
    for mode in auto-deploy programmatic; do
      line="$(grep -E "${id} \\[${origin}\\] / ${mode} " "$ROOT"/java/verification-harness/target/surefire-reports/*.txt "$harness_log" -h | head -1 || true)"
      if [ -z "$line" ]; then
        echo "the harness did not run the ${origin} project $id in mode $mode" >&2
        exit 1
      fi
      echo "$line"
    done
  done
}
check_runs generated "${expected_ids[@]}"
check_runs ui ${ui_ids[@]+"${ui_ids[@]}"}
rm -f "$harness_log"

printf '\n========== verify-all: all sections passed ==========\n'
