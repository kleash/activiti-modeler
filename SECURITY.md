# Security policy

## Supported versions

Security fixes go to the default branch (`main`) and into the next release. Only the latest release is supported: fixes are not backported to older ones.

| Version | Supported |
|---|---|
| `main` and the latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a vulnerability.**

Report it privately with GitHub's private vulnerability reporting: on the repository page open **Security > Advisories > Report a vulnerability** (direct link: <https://github.com/kleash/activiti-modeler/security/advisories/new>). Only the maintainers and you can see the report, and a fix can be prepared in a private fork before anything is published.

If that button is missing, open a public issue that says only "I need a private way to report a security problem", with no details, and a maintainer will arrange one.

Please include:

- what is affected (the modeler web app, the server jar, the Docker image, a library module such as `activiti-runtime-rest-core`) and its version or commit;
- the steps to reproduce it, or a proof of concept;
- the impact as you see it.

The maintainers acknowledge the report, work on it as time allows (no fixed deadline is promised), and credit you in the advisory unless you prefer not to be named.

## What is in scope

- The code of this repository: the modeler web app (`modeler/`), the server and the libraries (`java/`), the container image built from the `Dockerfile`, and the build and release workflows (`.github/workflows/`).
- Known vulnerabilities in the dependencies that this project ships and that are reachable in the way it uses them.

By design the server **runs the models** you deploy, which is remote code execution for whoever can sign in ([ADR 0007](docs/adr/0007-runtime-rest-split-and-security.md)). It binds to `127.0.0.1` by default, and the Docker instructions publish the port on `127.0.0.1` only. Reaching it from another machine needs your own authentication in front of it. A report that depends on exposing the server to an untrusted network or on giving an attacker a login is a hardening request, not a vulnerability.

## What the automated scans cover

The rule is **no known vulnerability in anything the project ships**, and it is enforced: a pull request that adds one fails the OSV scan, and a release cannot be made. Details for contributors are in the [developer guide](docs/developer-guide.md#security-scanning).

What is scanned, by the **OSV scan** (`.github/workflows/osv-scan.yml`, run by `scripts/cve-scan.sh`; on every pull request, on every push to `main`, every Monday and by hand) with [OSV-Scanner](https://google.github.io/osv-scanner/) pinned by version and by SHA-256:

| Shipped artifact | What is scanned |
|---|---|
| The server jar, inside the desktop bundles and the Docker image, on Activiti 9.0.0 **and** on Activiti 8.8.1 (both on Spring Boot 3.5.16) | the CycloneDX SBOM of its runtime dependencies, **and** the built jar itself (which also shows libraries that are repackaged into another jar and so appear in no SBOM) |
| The libraries `activiti-runtime-rest-core`, `activiti-dmn-connector`, `activiti-dmn-connector-kie` | their CycloneDX SBOMs, runtime scope. A host application's own BOM decides the versions it gets: the [integration guide](docs/integration-guide.md#security-spring-boot-3516-ships-vulnerable-versions-pin-these-in-your-app) lists the versions to pin |
| The web app | `npm sbom` of the production dependencies |
| The Docker image (built `FROM scratch`: the musl C library and the Java runtime, no shell, no package manager) | every package in the image, operating system included (the one OS package, `musl`, is listed in the image's package database, so the scanner checks it against the Alpine advisories) |

The gate **fails** on any known vulnerability that [`osv-scanner.toml`](osv-scanner.toml) does not except, on an exception that has **expired** or that no longer matches anything, and on an exception without a reason, an expiry of at most 90 days, and a statement in the [OpenVEX file](docs/security/vex.openvex.json). Test and build-time dependencies are not shipped and not scanned; the Spring Boot 3.5.7 compatibility run in CI is a test, not a release, and is not scanned either.

Also: **dependency review** fails a pull request that adds a dependency with a known vulnerability (any severity); **CodeQL** scans the Java and TypeScript code; **Dependabot** security updates open fix pull requests for advisories in the Maven and npm dependencies, and Dependabot version updates keep the pinned GitHub Actions and the pinned base images of the Dockerfile (the Alpine image that supplies musl and the JDK image that builds the jar) current. Every action is pinned to a commit SHA. The release attaches the CycloneDX SBOMs (jar, web app, image), the OpenVEX statement and `SHA256SUMS`, and runs the same gate before anything is published.

These scans find **known** vulnerabilities in dependencies. They do not replace a review of the code, they do not find a flaw nobody has reported yet, and OSV lags the vendors by hours or days (so the scan also runs every Monday). The Java runtime inside the desktop bundles and the image is not covered by OSV (nor are the copies of zlib and FreeType that every JDK carries): the release builds the bundles with the newest Temurin 25 release available and prints the exact version in the release notes. The image's runtime is linked from the Alpine build of Temurin 25 that [`docker/jdk-alpine.env`](docker/jdk-alpine.env) pins by version and SHA-256; Dependabot cannot move that file, so the release workflow runs `scripts/update-jdk-alpine.sh`, which prints a warning when a newer Temurin 25 build exists (and fails when the Adoptium API publishes another checksum for the pinned build), and `scripts/update-jdk-alpine.sh --write` does the update.

## Open vulnerabilities and why they are accepted

Three advisories are **open** in the current release. They are the only recorded exceptions; they are recorded in [`osv-scanner.toml`](osv-scanner.toml) (the machine-enforced copy) and in the [OpenVEX statement](docs/security/vex.openvex.json) (the published copy, with status `not_affected` and the justification `vulnerable_code_not_in_execute_path` for the Spring pair and `vulnerable_code_cannot_be_controlled_by_adversary` for OGNL):

| Advisory | Component | Fixed in |
|---|---|---|
| [GHSA-pc63-qcmh-9cmg](https://github.com/advisories/GHSA-pc63-qcmh-9cmg) / CVE-2026-47884: `XsltView` can be abused for SSRF and RCE if the application has a `/**` mapping that renders a view without an explicit view name | `org.springframework:spring-webmvc` 6.2.19 (Spring Boot 3.5.16, the last 3.5.x) | Spring Framework 7.0.9 (Spring Boot 4), and 6.2.20, which spring.io lists as **Enterprise Support Only** |
| [GHSA-j9f9-w8pj-32f8](https://github.com/advisories/GHSA-j9f9-w8pj-32f8) / CVE-2026-47890: Server-Sent Events stream corruption when rendering view fragments | `org.springframework:spring-webmvc` 6.2.19 | the same |
| [GHSA-crwc-vw2r-qr6m](https://github.com/advisories/GHSA-crwc-vw2r-qr6m) / CVE-2026-113730: OGNL's optional stricter-invocation block list can be bypassed through reflection proxies (hardening of a secondary layer; GitHub: Moderate, 5.6) | `ognl:ognl` 3.4.4, **repackaged inside** `org.mybatis:mybatis` 3.5.19 (the engine's persistence layer; in no Maven SBOM, found by the scan of the built jar and of the image) | OGNL 3.4.13, which MyBatis 3.6.0 embeds (3.4.16); but `activiti-engine` 9.0.0 and 8.8.1 do not start on MyBatis 3.6.0 (`NoSuchMethodError TypeHandlerRegistry.register`, tried), and 3.5.19 is the last 3.5.x |

**Docker image, operating-system layer (clean, nothing excepted).** The image is built `FROM scratch` and holds one operating-system package, Alpine Linux 3.24's `musl` (the C library; the Java runtime is the Alpine/musl build of Temurin 25, which needs nothing else: it carries its own zlib, FreeType and CA certificates). OSV lists **no** advisory for it, so the image scan reports no operating-system finding. If an advisory for `musl` appears and Alpine has no fix, the image scan fails, and so does a release, until Alpine ships a fix and Dependabot moves the pinned Alpine base image, or a maintainer records a reviewed exception with the 30-day limit that applies to operating-system advisories.

**Why they are accepted.** There is no fixed version that can run here. For the two Spring advisories: Spring Framework 6.2 and Spring Boot 3.5 no longer get free security fixes, and Spring Framework 7 needs Spring Boot 4, which no stable Activiti release supports. For OGNL: the only MyBatis with a patched OGNL does not run with Activiti. Everything else that can be fixed is fixed (see the version overrides in [`java/pom.xml`](java/pom.xml)).

**Why this project is not affected.** The evidence, checked in the sources:

- The server has no `XsltView`, no `ViewResolver` bean of its own, no template engine (no Thymeleaf, FreeMarker, Mustache, JSP) and no `ModelAndView`. Every controller is a `@RestController` that returns JSON. The only `/**` mapping is the static resource handler of the web app (`WebConfiguration.addResourceHandlers`), which returns files and renders no view.
- The server uses no `SseEmitter`, no `ServerSentEvent` and no `text/event-stream`, and renders no view fragments.
- spring.io rates the first advisory Medium and the second Low (OSV and GitHub score both 9.8).
- OGNL, justification `vulnerable_code_cannot_be_controlled_by_adversary`: the advisory only matters to an application that evaluates attacker-controlled OGNL expressions. MyBatis evaluates OGNL only for the expressions written in mapper XML (`<if test>`, `<foreach>`, `${...}`); the engine's mappers are packaged in the `activiti-engine` jar, user input only supplies the values those expressions read, never expression text, and the server configures no custom mapper.
- **Not covered:** an application that embeds the libraries and adds XSLT views or SSE with view fragments of its own, or builds MyBatis mappers from untrusted text, decides for itself. The libraries declare Spring MVC only as `provided`, so the host's Spring version applies.

**Expiry.** The exception ends on **2027-01-25** (at most 90 days after it was written). On that day the scan fails again until a maintainer either removes it (a fix exists), or renews it in a reviewed pull request that states what changed. The same statement is printed in the notes of every release.

**What would end it.** For OGNL: an Activiti release that runs on a MyBatis with OGNL 3.4.13 or newer. For Spring: a fix in Spring Framework 6.2 that is available without a support contract, or the port to Spring Boot 4 and Spring Framework 7, which is on the [roadmap](README.md#roadmap) for when a stable Activiti release supports it. Spring Framework 6.2 and Spring Boot 3.5 get no more free security fixes, so **new** advisories in them will appear and have to be handled the same way until the port.

## Hardening the Docker image

The image is built `FROM scratch` (musl and the Java runtime; no shell, no package manager, no `apk`) and runs as the unprivileged user id 65532. Add `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges` to the `docker run` line to remove what the server does not need (`scripts/smoke-docker.sh` runs the whole smoke test that way); a folder you mount on `/data` must be writable by user id 65532. The `HEALTHCHECK` is a Java class, so there is no shell to exec into: use `docker logs` and `docker inspect`.

## Something the scans missed

Report it, or a disagreement with the exceptions above, through the private channel in [Reporting a vulnerability](#reporting-a-vulnerability), not in a public issue.
