# Contributing

The [developer guide](docs/developer-guide.md) covers setup, commands, the layout and the conventions. The technical decisions every change follows are the ADRs in [`docs/adr/`](docs/adr/). [CLAUDE.md](CLAUDE.md) has the essentials on one page, for contributors who work with Claude Code.

## Workflow

1. For a larger change, open an issue first so that the approach can be agreed on.
2. Work on a branch; do not commit to the default branch.
3. Make the change together with its tests and its documentation.
4. Run `scripts/verify-all.sh` and fix what it reports. CI runs the same script. On macOS and Windows run it in a Linux container, as below.
5. Open a pull request that says what changed and why. The template has a short checklist.

Write the commit subject as a plain sentence about what changed, and give the reason in the body when it is not obvious.

### Running the tests in a Linux container

The Playwright suite presses Linux keys (`Control+S`, `Control+End`) and checks Linux shortcut labels, so it fails on macOS by design. Run it, and the whole gate, on Linux or in the Playwright image, which already has the matching Chromium. Copy the repository into the container instead of working on the mounted folder, so that the host's `node_modules` stay out of it:

```bash
# on the host, from the repository root
docker run --rm -it -v "$PWD":/src:ro -v activiti-modeler-m2:/root/.m2 mcr.microsoft.com/playwright:v1.63.0-noble bash

# in the container
apt-get update && apt-get install -y maven rsync binutils zip
rsync -a --exclude node_modules --exclude .tools --exclude target /src/ /work/
cd /work
scripts/setup-jdk.sh && source scripts/env.sh
scripts/verify-all.sh
```

## Rules that are easy to break

- **Native Activiti output only.** The modeler emits `activiti:` attributes and elements. Never load or emit `camunda:` or `zeebe:` anything. A Camunda concept is translated to its Activiti 9 equivalent or dropped.
- **Stable versions only.** Activiti 9.0.0 on Spring Boot 3.5.x and JDK 25, and Activiti 8.8.1 on JDK 21 as the second target. No alpha or pre-release builds.
- **Pin exact versions.** npm dependencies have no `^` or `~` (`.npmrc` sets `save-exact`). The bpmn.io packages (bpmn-js, dmn-js, bpmn-js-properties-panel, @bpmn-io/properties-panel) are upgraded together, in a dedicated change.
- **Keep the bpmn.io watermark visible.** Do not place UI over the bottom-right corner of a bpmn-js or dmn-js canvas. The e2e test fails if it is covered.
- **Claims need tests.** A feature is `supported` when an engine-level assertion on a model the modeler generated proves it: a scenario step, a `model-expect.json` entry or a harness test. User-facing behaviour also needs a Playwright test, and for a feature without engine behaviour the Playwright test is the proof. A claim about engine behaviour is proved by running it on Activiti 9.0.0.
- **Oracles are hand-written.** Scenarios and `model-expect.json` are written from the Activiti sources and the BPMN specification, never copied from engine output, and the corpus builds never generate them.
- **Flakes are bugs.** No retries and no fixed waits: wait for the state the test needs, and fix the cause.
- **No secrets** in the repository. The demo users in the server and the harness are for local development only.

## Documentation

Update the docs in the same change:

- `CHANGELOG.md`: add a line under *Unreleased* ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format).
- `docs/FEATURE_MATRIX.md`: keep each row's status current, and name the proof of a `supported` row in `docs/verification-index.md`.
- `docs/engine-findings.md`: engine behaviour you established, with the scenario or test that shows it.
- `docs/adr/`: add an ADR for any new technical decision (next free number, same layout as the existing ones).
- `docs/user-guide/`: what a user sees.
- `docs/README.md`: link any new document.

## Tests

- Java: JUnit 5 and AssertJ, next to the code in `src/test/java`.
- TypeScript: Vitest, in `*.test.ts` files next to the code.
- UI: Playwright, in `modeler/e2e/`.
- Engine behaviour: a scenario in the corpus project that covers it (`corpus/<id>/scenarios/`), in the format of the [scenario reference](docs/user-guide/scenarios.md).

## Conduct and security

Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md). Report a vulnerability privately as [SECURITY.md](SECURITY.md) describes, never in an issue.
