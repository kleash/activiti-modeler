# CLAUDE.md

Notes for contributors who work on this repository with Claude Code. Everything here also holds without it. The [developer guide](docs/developer-guide.md) has the details, and [CONTRIBUTING.md](CONTRIBUTING.md) the rules for a pull request.

## Setup

- **Start every Bash call with `source scripts/env.sh`.** Shell state does not carry over between Bash calls, and `env.sh` puts the project's JDK 25 (`.tools/jdk-25`) on `JAVA_HOME` and `PATH`. Activiti 9.0.0 is Java 25 bytecode; the Maven build refuses an older JDK.
- **JDK.** `scripts/setup-jdk.sh` downloads Temurin 25 into `.tools/jdk-25` when `java` is older (Linux and macOS, x64 and aarch64; on Windows `scripts/setup-jdk.ps1`). For the second target, Activiti 8.8.1 on JDK 21: `ACTIVITI_LINE=8 scripts/setup-jdk.sh` once, then `ACTIVITI_LINE=8 source scripts/env.sh`.
- **Node 22 or newer with npm 10, and Maven** (`mvn` on the `PATH`; the scripts call it). `npm ci` in `modeler/` installs exactly what `package-lock.json` says.
- **Playwright runs on Linux.** The suite presses Linux keys (`Control+S`, `Control+End`) and checks Linux shortcut labels, so on macOS it fails by design. On Linux install the browser with `npx playwright install --with-deps chromium` in `modeler/`. On macOS and Windows run the e2e specs and the gate in a container from `mcr.microsoft.com/playwright:v1.63.0-noble` with `maven`, `rsync`, `binutils` and `zip` added: mount the repository read-only and rsync it into the container without `node_modules`, `.tools` and `target`. [CONTRIBUTING.md](CONTRIBUTING.md#running-the-tests-in-a-linux-container) has the commands. The image already has the matching Chromium: do not run `playwright install` in it.
- **Windows.** `build.cmd` and `run.cmd` build and start the modeler, but the test scripts are bash: use a Linux environment for them.

## Build and test

```bash
source scripts/env.sh
scripts/verify-all.sh                        # the full gate; CI runs the same script
SKIP_COMPAT_CHECK=1 scripts/verify-all.sh    # without the Activiti x Spring Boot matrix (section 3)
BOOT_VERSION=3.5.7 scripts/verify-all.sh     # the Java sections on another Spring Boot 3.5.x
ACTIVITI_LINE=8 scripts/verify-all.sh        # Activiti 8.8.1 on JDK 21; skips section 8, the app ships on 9.0.0
```

`verify-all.sh` stops at the first failing section and names it:

| # | Section |
|---|---|
| 1 | toolchain versions |
| 2 | `mvn clean verify` in `java/`: the Java modules and the hand-written seed corpus on the engine |
| 3 | `compat-check/run-matrix.sh`: Activiti x Spring Boot combinations |
| 4 | `npm ci` in `modeler/` |
| 5 | typecheck and ESLint |
| 6 | Vitest |
| 7 | production build of the app |
| 8 | Playwright: the UI suite and the suite against the real modeler server |
| 9 | lint over the corpus seeds |
| 10 | corpus builds: the modeler rebuilds every corpus project through its test API, and those whose `build.ts` sets `uiDriven` also through the real UI |
| 11 | the verification harness over the projects the modeler generated |

npm scripts, in `modeler/` (or `npm --prefix modeler run <script>` from the root):

| Script | What it does |
|---|---|
| `dev` | the app on http://localhost:5173 |
| `build` | production build into `modeler/app/dist` |
| `typecheck`, `lint` | `tsc` in every workspace and in `e2e/`; ESLint |
| `test` | Vitest in every workspace; `npm test -w @activiti-modeler/<package>` for one |
| `e2e` | both Playwright suites; `e2e:ui` the UI suite, `e2e:server` the suite against the real modeler server |
| `corpus:build` | drive the modeler to rebuild the corpus; `npm run corpus:build -- C04` for one project |
| `lint:corpus` | lint every corpus seed |
| `verify` | all of the above, in order |

Maven, from the repository root:

```bash
mvn -B -f java/pom.xml verify                                     # every module
mvn -B -f java/pom.xml -pl activiti-modeler-server -am test       # one module and what it depends on
mvn -B -f java/pom.xml -pl activiti-scenario-runner,verification-harness -am verify -Dharness.projects=C04,C10   # the harness on some projects
mvn -B -f java/pom.xml -Pactiviti8 verify                         # Activiti 8.8.1, with JDK 21
```

## Verification rules

- **A feature is `supported` only with an engine-level assertion on a model the modeler generated:** a scenario step, a `model-expect.json` entry or a harness test that runs on the project a `corpus/<id>/build.ts` exports. A hand-written seed alone never counts. User-facing behaviour also needs a Playwright test, and for a feature without engine behaviour the Playwright test is the proof. Record the status in `docs/FEATURE_MATRIX.md` and the proof in `docs/verification-index.md`; the harness's `DocsConsistencyTest` fails when the two disagree.
- **Oracles are hand-written.** Scenarios and `model-expect.json` are written from the Activiti sources and the BPMN specification, never copied from engine output, and the corpus builds never generate them.
- **Engine behaviour is proved by running it.** Write it down in `docs/engine-findings.md` with the scenario or test that shows it.
- **Flakes are bugs.** No retries (every Playwright config sets `retries: 0`) and no fixed sleeps: wait for the state the test needs, and fix the cause in the app or the test.

## Conventions

Read the conventions of the [developer guide](docs/developer-guide.md) and the rules in [CONTRIBUTING.md](CONTRIBUTING.md) before you change code. The ones that break most easily:

- the modeler writes `activiti:` only and never loads or emits `camunda:` or `zeebe:` moddle, providers or behaviours;
- every entry of the properties panel reads and writes through the `propertyAccessors` service, so the panel, the test API and the corpus builds share one code path;
- versions are exact (`.npmrc` saves them so), and the bpmn.io packages are upgraded together;
- nothing covers the bpmn.io watermark (`modeler/e2e/watermark.spec.ts` checks every canvas and layout);
- the docs change in the same change: `CHANGELOG.md`, the feature matrix, the engine findings, an ADR for a new decision, the user guide.

## Where things are

| Path | What |
|---|---|
| `modeler/packages/` | the libraries: `activiti-moddle`, `bpmn-js-activiti` (support matrix, extensions store, property accessors, export), `bpmnlint-plugin-activiti` (the lint and its quick fixes), `activiti-project` (project files, storage, DMN normalizer, Camunda importer), `activiti-variable-resolver`, `activiti-diagram-viewer`, `runtime-client` |
| `modeler/app/` | the React shell: editors, properties panel, Problems panel, run views |
| `modeler/e2e/` | Playwright: the UI specs, `server/` (against the real modeler server), `corpus/` (the corpus builds) |
| `java/` | the Maven modules: the DMN connectors, the scenario runner, the runtime REST core and dev parts, the modeler server, the verification harness |
| `corpus/` | the verification corpus: `seed/` (reference models), `scenarios/` and `model-expect.json` (oracles), `build.ts` (the modeler rebuilds the seed) per project, and `N01-negative` |
| `schemas/` | JSON schemas of scenarios, `model-expect.json` and coverage exemptions |
| `compat-check/` | the Activiti x Spring Boot compatibility probe |
| `scripts/` | JDK setup, the gate, builds, smoke tests, the security scan |
| `docs/` | user guide, developer and integration guides, feature matrix, verification index, engine findings, ADRs ([index](docs/README.md)) |

## Shell habits

- **Never use `pkill -f`** (or `pgrep -f` with a pattern that also appears in your own command line): it matches and kills the calling shell. Free a port with `fuser -k <port>/tcp` on Linux and `lsof -ti tcp:<port> | xargs kill` on macOS.
- **A killed Playwright run can leave `vite preview` on port 4173.** Outside CI the next run reuses that server (`reuseExistingServer`) and tests the old build, so free the port before you run again.
- **Prefer the tools' own directory flags to `cd`:** `mvn -f java/pom.xml`, `npm --prefix modeler`, `git -C`, or absolute paths. A compound command that changes into a directory outside the repository and then writes makes Claude Code ask for permission.
