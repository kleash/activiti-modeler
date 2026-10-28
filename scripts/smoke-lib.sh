# shellcheck shell=bash
# Shared by scripts/smoke-server.sh, smoke-bundle.sh and smoke-docker.sh: the checks every way of running the modeler must pass.
# Source it, set LOG (the server's output file, shown when a check fails) and call the functions.
#
#   smoke_wait_health <base-url> <pid|0> [seconds]   waits for /api/health; stops early when the process dies
#   smoke_checks <base-url> <user:password> [loopback-port]
#                                                    health, engine, authentication, the app, a workspace round trip, a validate, a decision
#                                                    call and a scenario run (JavaScript and mail tasks); with a port also checks that nothing
#                                                    listens beyond the loopback address
SMOKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v cygpath >/dev/null 2>&1; then SMOKE_DIR="$(cygpath -m "$SMOKE_DIR")"; fi   # Git Bash: curl.exe reads @C:/... but not @/d/...

smoke_wait_health() {
  local base="$1" pid="$2" seconds="${3:-180}" i
  for ((i = 0; i < seconds; i++)); do
    if curl -fsS "$base/api/health" >/dev/null 2>&1; then return 0; fi
    if [ "$pid" != 0 ] && ! kill -0 "$pid" 2>/dev/null; then echo "the server stopped:"; tail -40 "${LOG:-/dev/null}"; return 1; fi
    sleep 1
  done
  echo "the server did not come up in ${seconds} s:"; tail -40 "${LOG:-/dev/null}"
  return 1
}

smoke_check() { # smoke_check <description> <command...>
  local description="$1"; shift
  if "$@"; then echo "ok   $description"; else echo "FAIL $description"; tail -40 "${LOG:-/dev/null}"; return 1; fi
}

smoke_status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

smoke_checks() {
  local base="$1" credentials="$2" port="${3:-}"
  local auth=(-u "$credentials")
  echo "--- GET /api/health"; curl -fsS "$base/api/health"; echo
  echo "--- GET /api/engine"; curl -fsS "${auth[@]}" "$base/api/engine"; echo
  echo "--- GET / (head)"; curl -fsS "$base/" | head -c 400; echo

  smoke_check "/api/engine without credentials is 401" test "$(smoke_status "$base/api/engine")" = 401 || return 1
  smoke_check "/api/engine with the credentials is 200" test "$(smoke_status "${auth[@]}" "$base/api/engine")" = 200 || return 1
  smoke_check "a wrong password is 401" test "$(smoke_status -u "${credentials%%:*}:wrong-password" "$base/api/engine")" = 401 || return 1
  smoke_check "engine report names Activiti 9.0.0" bash -c "curl -fsS -u '$credentials' '$base/api/engine' | grep -q '9.0.0'" || return 1
  smoke_check "the index page is the modeler app" bash -c "curl -fsS '$base/' | grep -qi '<div id=\"root\"'" || return 1
  smoke_check "the app's script is served" bash -c "src=\$(curl -fsS '$base/' | grep -o 'assets/[^\"]*\\.js' | head -1); test -n \"\$src\" && curl -fsS -o /dev/null \"$base/\$src\"" || return 1
  smoke_check "the response carries the server header the app looks for" bash -c "curl -fsSI '$base/' | grep -qi '^x-activiti-modeler-server'" || return 1
  smoke_check "an app route falls back to the index page" test "$(smoke_status "$base/projects/some-route")" = 200 || return 1
  smoke_check "a workspace file can be written" test "$(smoke_status "${auth[@]}" -X PUT -H 'Content-Type: application/json' --data '{"a":1}' "$base/api/dev/workspace/smoke/a.json")" = 201 || return 1
  smoke_check "and read back" bash -c "curl -fsS -u '$credentials' '$base/api/dev/workspace/smoke/a.json' | grep -q '\"a\"'" || return 1
  smoke_check "a path traversal is refused" test "$(smoke_status "${auth[@]}" --path-as-is "$base/api/dev/workspace/../../etc/passwd")" != 200 || return 1
  # the engine really runs: validate deploys the process into a scratch engine, evaluate runs the DMN engine (Scala)
  smoke_check "a process validates on the engine" bash -c "curl -fsS -u '$credentials' -H 'Content-Type: application/json' --data @'$SMOKE_DIR/smoke/validate-request.json' '$base/api/dev/validate' | grep -q '\"valid\" *: *true'" || return 1
  smoke_check "a decision table is evaluated" bash -c "curl -fsS -u '$credentials' -H 'Content-Type: application/json' --data @'$SMOKE_DIR/smoke/decision-request.json' '$base/api/dev/decisions/evaluate' | grep -q 'review'" || return 1
  # a scenario on the live engine: the script task runs JavaScript (Nashorn, which needs the jdk.dynalink module of a trimmed Java runtime) and the mail
  # task delivers to the embedded SMTP server (GreenMail), whose mailbox the dev API shows
  smoke_check "a scenario runs on the engine (JavaScript script task, mail task)" bash -c "curl -fsS -u '$credentials' -H 'Content-Type: application/json' --data @'$SMOKE_DIR/smoke/scenario-request.json' '$base/api/dev/scenarios/run' | grep -q '\"passed\" *: *true'" || return 1
  smoke_check "the mail of the scenario reached the embedded SMTP server" bash -c "curl -fsS -u '$credentials' '$base/api/dev/mail' | grep -q 'Smoke total 60'" || return 1
  if [ -n "$port" ]; then
    if command -v ss >/dev/null 2>&1; then
      smoke_check "the server listens on the loopback address only" bash -c "! ss -ltn 2>/dev/null | grep -E ':$port\\b' | grep -vE '127\\.0\\.0\\.1|\\[::1\\]'" || return 1
    elif command -v hostname >/dev/null 2>&1 && other="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | head -1)" && [ -n "$other" ]; then
      smoke_check "the server is not reachable on $other (this machine's other address)" bash -c "! curl -sS -m 5 -o /dev/null 'http://$other:$port/api/health' 2>/dev/null" || return 1
    else
      echo "skip the loopback binding check (neither ss nor hostname -I on this system)"
    fi
  fi
}
