# ADR 0008: Distribution: download and run

- Status: Accepted
- Date: 2026-10-27

## Context

The requirement: anyone must be able to use the modeler **as easily as Camunda Modeler**:
- either download and run;
- or download, compile with one command, and run.

Before this decision, a user needed:
- JDK 25, which few people have installed;
- Maven;
- Node 22;
- a two-step build (`scripts/build-server.sh`);
- the command-line options `--open` and `--workspace` to get a usable session.

What helped already:
- `activiti-modeler-server` is one executable jar holding the web app, the REST API and an embedded Activiti 9.0.0 engine on H2.
- It listens on `127.0.0.1` only, has demo users, and can open the browser (`--open`).

## Decision

### Ways to get it, from simplest to most flexible

| Way | Needs | Command | Built by |
|---|---|---|---|
| **Desktop bundle** per OS: Linux x64, macOS arm64, macOS x64, Windows x64 | nothing (a Java 25 runtime is inside) | download and unzip, then double-click `Activiti Modeler` (or `bin/activiti-modeler`) | `jpackage` app image, zipped, on the release workflow's OS matrix |
| **Executable jar** | Java 25 | `java -jar activiti-modeler.jar` | Maven |
| **Docker image** | Docker | `docker run -p 127.0.0.1:8080:8080 ghcr.io/kleash/activiti-modeler` | release workflow, pushed to GHCR |
| **Online, browser only** | a browser | open the GitHub Pages URL | static build of the app; projects stay in the browser, and run features need a server |
| **From source** | git and a JDK of any version, or none | `./build.sh` then `./run.sh` | the scripts fetch JDK 25 (`scripts/setup-jdk.sh`) and use the Maven wrapper; Maven builds the web app through `frontend-maven-plugin`, which downloads its own Node, so no Maven or Node install is needed |

### Behaviour on start without arguments

This is what makes double-click work.

- **Workspace:** `~/ActivitiModeler/workspace` is the default, created on first start, so projects persist on disk with no flag. `--workspace` still overrides it.
- **Port:** 8080, falling back to a free port if 8080 is taken. The URL actually used is printed.
- **Browser:** opens by default. `--no-open` (or headless or Docker) suppresses it.
- **Status window:** when a display is available, a small "Activiti Modeler is running" window shows the URL and the sign-in, with **Open in browser** and **Quit** buttons. Closing the window stops the server.
  - A double-clicked app otherwise has no visible way to stop it.
  - Headless environments skip the window.
- **Logs:** go to `~/ActivitiModeler/logs/` as well as the console.

### Security stays as in ADR 0007

- The server binds to loopback.
- On loopback, the demo users stay as they are.
- In the Docker image the server must bind `0.0.0.0` inside the container. The image therefore:
  - generates a random password for the `modeler` user on first start, unless `MODELER_PASSWORD` is set;
  - prints the password;
  - documents publishing the port as `127.0.0.1:8080:8080`.

### Release workflow

Pushing a tag `v*`:

1. runs `scripts/verify-all.sh`;
2. builds the jar, the four desktop bundles, the Docker image and the static site;
3. **smoke-tests each bundle on its own runner**, starting it, checking `/api/health` and the bundled app, and stopping it (`scripts/smoke-server.sh`);
4. creates a GitHub Release with the bundles, the jar, `SHA256SUMS`, release notes from `CHANGELOG.md`, and the Docker and Pages links.

### Licensing

- **The project:** Apache-2.0, with `LICENSE` and `NOTICE` at the root.
- **Third-party licences:** `THIRD-PARTY-NOTICES.md` lists the bundled third-party licences:
  - Activiti, Spring Boot, H2, Operaton DMN and the KIE libraries;
  - the bpmn.io libraries, whose licence requires the watermark to stay visible;
  - the bundled Eclipse Temurin runtime (GPLv2 with Classpath Exception, redistributable).
- **Where they go:** the notices are copied into every bundle and into the jar under `META-INF/`.

### Not in scope

- Code signing for Windows: it needs a paid certificate. The install guide explains how to open the unsigned app (SmartScreen, then "More info", then "Run anyway").
- Signing in CI. The macOS apps are signed with the maintainer's Developer ID and notarized (from release 1.0.0), but on the maintainer's Mac, where the certificate stays: the release workflow leaves the GitHub Release a draft, and `scripts/sign-macos.sh` signs the two macOS bundles, publishes the release and updates the Homebrew cask (`kleash/homebrew-tap`).
- Installers (`.dmg`, `.msi`, `.deb`). Zipped app images avoid installer tooling and admin rights.

## Consequences

- The release workflow needs macOS and Windows runners, so those bundles are verified only on CI. Locally only the Linux bundle can be built and smoke-tested.
- GitHub Pages and GHCR need one-time repository settings by a maintainer: Pages source "GitHub Actions", and package visibility. The install guide lists them.
- The bundles add roughly 60–80 MB each, the size of a trimmed Java 25 runtime from `jlink`.

## Implementation notes

How the design was built, and where the build differs from the text above, with the reason.

- **`macos-13` is `macos-15-intel`.** GitHub retired the `macos-13` runner image in December 2025; `macos-15-intel` is the Intel x64 runner that replaces it. `macos-14` (arm64) is unchanged.
- **The KIE libraries are not in the bundle.** `activiti-dmn-connector-kie` is not a dependency of `activiti-modeler-server`: the jar carries Operaton DMN only. `THIRD-PARTY-NOTICES.md` is generated from the jar's real contents, so it lists what is there.
- **Docker: every demo user gets the one password.** The ADR names the `modeler` user. `alice` and `bob` have weak demo passwords and reach the core API, so on a network-facing container they would be a hole; they keep their roles but share `MODELER_PASSWORD` (or the generated password).
- **The defaults of a start without arguments are Spring default properties computed by `main`** (`StartupDefaults`), not entries in `application.properties`, and `server.port=8080` was removed from `application.properties`. Reason: default properties are the lowest precedence, so every explicit setting (argument, variable, profile file, a user's own `application.properties`) wins, and tests, which never run `main`, get none of them. The port fall back needs the check before Spring starts.
- **One Maven profile, `bundle-modeler`,** also builds the web app (`frontend-maven-plugin`); `-Dmodeler.skipFrontend=true` skips that step for `scripts/build-server.sh`, which builds the web app itself. The `release` profile of `java/pom.xml` is for Maven Central only (ADR 0009).
- **The launcher is `Activiti Modeler`** (Linux `bin/Activiti Modeler`, Windows `Activiti Modeler.exe`, macOS `Activiti Modeler.app`); `jpackage` derives the launcher name from the app name, so there is no `bin/activiti-modeler`.
- **Release asset names:** `activiti-modeler-<version>-<os>-<arch>.zip` with `os` one of `linux`, `macos`, `windows` and `arch` `x64` or `arm64`, and `activiti-modeler-<version>.jar`.
- **The bundles are built from one jar** (built once on Linux, version set from the tag with `versions:set`), then `jlink` and `jpackage` run on each operating system, which cannot be avoided: the runtime is native. Each runner smoke-tests its own bundle with `scripts/smoke-bundle.sh`.
- **The Docker image is smoke-tested on `linux/amd64` only;** the `linux/arm64` image is built by the same Dockerfile (the jar and the health check class are platform independent; the jlink runtime stage runs once per target platform, under QEMU for arm64 on an amd64 builder, see the revision on musl below) and is not run in CI.
- **The Windows and macOS bundles are built and smoke-tested by the release workflow only,** on runners of their own system; CI builds and tests the Linux bundle.

## Revision 2026-10-27: security of what is distributed

- **Docker image on a distroless base** (superseded by the next revision: `FROM scratch` on musl). The runtime stage moved from `eclipse-temurin:25-jre` (Ubuntu 26.04, 106 packages, 62 operating-system advisories without a fix at the time) to `gcr.io/distroless/base-debian13:nonroot` (glibc, OpenSSL, CA certificates, tzdata; no shell, no package manager; user id 65532). It carries **the same jlink-trimmed runtime as the desktop bundles**: `scripts/build-runtime.sh` (the `jdeps` and `jlink` logic that was in `scripts/package-desktop.sh`) is used by both. Both base images are pinned by digest, and Dependabot's `docker` ecosystem opens the pull requests that move them. The `/data` volume, the `container` profile and the random password are unchanged. There is no shell, so the `HEALTHCHECK` is a small Java class (`docker/Healthcheck.java`) run by the image's own Java, and `scripts/smoke-docker.sh` checks the container from outside (`docker inspect`, `docker top`, `docker cp`). The user id changed from 10001 to 65532: a mounted folder must be writable by that id.
- **The runtime is a JDK taken from a pinned image, not "the newest Temurin"** (superseded by the next revision: the Alpine build pinned in `docker/jdk-alpine.env`). The jlink stage uses `eclipse-temurin:25-jdk` by digest, so its Java is the one that image carries; the desktop bundles use whatever `actions/setup-java` resolves `25` to (the newest Temurin 25 GA). The release notes print both versions. OSV does not cover a JDK.
- **Releases carry their evidence.** Besides the bundles, the jar and `SHA256SUMS`: the CycloneDX SBOMs of the jar, the web app and the image, and the OpenVEX statement for the documented exception (`docs/security/`). A release runs the OSV gate (`scripts/cve-scan.sh`) before anything is pushed or published.
- **Spring Boot.** What ships is Spring Boot 3.5.16 on both Activiti lines. 3.5.7 stays a CI compatibility run and is never released or scanned.

## Revision 2026-10-27, Docker image on musl: zero operating-system findings

The distroless base of the revision above still had 23 OSV findings without a Debian fix (21 in `glibc`, 2 in `zlib`). The image now builds `FROM scratch` on **musl**, which has none. This replaces the "distroless" and "JDK taken from a pinned image" bullets above; everything else of that revision stands.

- **What is in the image.** The Java runtime, the jar, the health check class, the licence files, `/etc/passwd` and `/etc/group` (root and `nonroot` 65532), empty `/tmp` (1777), `/data` and `/home/nonroot` (owned by 65532), and the one operating-system package the runtime needs: Alpine's `musl` (`/lib/ld-musl-*.so.1`). Nothing else: no shell, no `apk`, no busybox, no OpenSSL, no zlib, no CA certificate bundle, no tzdata. The Java runtime needs none of them, as the build checks (`readelf` over every library of the runtime: only `libc.musl` and, for the unused `java.sound`, `libasound`); it carries its own CA certificates (`lib/security/cacerts`), zone data (`tzdb.dat`), zlib and FreeType. `ENV TZ=UTC` replaces the missing `/etc/localtime`.
- **The scanner still sees the package.** The image keeps the `musl` stanza of Alpine's package database (`/lib/apk/db/installed`) and four small text files (`/etc/os-release`, `/etc/alpine-release`, `/etc/apk/arch`, `/etc/apk/repositories`) that OSV-Scanner reads to name the Alpine release and CPU (it fails without them). Without the database the scan would pass for the wrong reason; with it, the scan lists `musl 1.2.6-r3` in the ecosystem `Alpine:v3.24` and finds no advisory. (The CycloneDX SBOM that `osv-scanner scan image` writes lists the Maven packages only, as it did for the Debian image.)
- **The runtime is the Alpine build of the newest Temurin 25.** `docker/jdk-alpine.env` pins the version (25.0.5+8) and the SHA-256 of the `x64` and `aarch64` archives, as the Adoptium API publishes them. The Dockerfile downloads `https://api.adoptium.net/v3/binary/version/jdk-<version>/alpine-linux/<arch>/jdk/hotspot/normal/eclipse` in an Alpine stage, picks `<arch>` from `TARGETARCH` (`amd64` to `x64`, `arm64` to `aarch64`) and refuses any other value, refuses an archive whose checksum differs, and runs the shared `scripts/build-runtime.sh` on it. That stage is `alpine:3.24.3` pinned by digest, because the Alpine JDK only runs on musl; it needs `bash` and `binutils` (jlink calls `objcopy`), which stay behind in the build stage. The `linux/arm64` archive exists for the same version (checked: musl only, same dependencies), so the release's multi-platform build selects it; it is built under QEMU and, like before, not run in CI.
- **Keeping it current.** Dependabot moves the two image digests but cannot move a download. `scripts/update-jdk-alpine.sh` compares the pin with the Adoptium API (a warning when a newer Temurin 25 GA exists, an error when the API publishes another checksum for the pinned version, a warning only when the API is unreachable) and `--write` rewrites `docker/jdk-alpine.env`; the release workflow runs it before building the image (the warning appears as an annotation on the run).
- **Every runtime includes `jdk.dynalink`.** Nashorn needs the module to run a JavaScript script task (without it: `NoClassDefFoundError: jdk/dynalink/RelinkableCallSite`), and `jdeps` does not report it because the jar's libraries are not analysed as modules. `scripts/build-runtime.sh` adds it to a fixed list, and `scripts/smoke-lib.sh` (used by the jar, bundle and image smoke tests) runs a scenario with a JavaScript script task and a mail task (GreenMail) and checks the delivered mail.
- **Smoke test.** `scripts/smoke-docker.sh` now also checks that the image has no package manager (`apk`, `busybox`, `wget`, `curl`, `apt`, `dpkg`), and runs a third time with `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges` on a new volume. Checked by hand on the image, not by a test: H2 in file mode on `/data` (`spring.datasource.url=jdbc:h2:file:/data/engine`), DNS resolution, outbound HTTPS and a TLS 1.3 handshake on loopback with the runtime's JSSE, all as user 65532 with a read-only root.
- **Size.** 223 MB on disk (95.7 MB compressed) against 262 MB (105 MB) for the distroless image.
- **Not covered by OSV.** The JDK's own copies of zlib (1.3.2) and FreeType (2.14.3), and the JDK itself: the pin is the control.
