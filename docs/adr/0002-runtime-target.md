# ADR 0002: Runtime target is Activiti 9.0.0 on Spring Boot 3.5.x and JDK 25

- Status: Accepted
- Date: 2026-10-26

## Context

`compat-check/README.md` records the checks behind this decision:
- **Where releases are published:** Maven Central stops at Activiti 7.1.0.M6. Releases 8.x and 9.x are only on the Alfresco repository.
- **9.0.0:** the latest GA. It is compiled to Java 25 bytecode and built against Spring Boot 3.5.7.
- **Spring Boot 4:** 9.0.0 fails to start on Boot 4.1.2 (`CacheManagerCustomizer` moved). Only the 9.1.0 alpha builds target Boot 4.
- **Constraint:** stable builds only; Boot 3 is fine.

## Decision

| Item | Version |
|---|---|
| Activiti | `org.activiti:activiti-dependencies:9.0.0` BOM, from `https://artifacts.alfresco.com/nexus/content/repositories/activiti-releases/` |
| Spring Boot | 3.5.x. Use 3.5.16 by default; 3.5.7 is Activiti's own baseline, and the matrix tests both. |
| JDK | 25 for the Java build and runtime. Node 22 for the web build. |

- **BOM order:** import `spring-boot-dependencies` first and `activiti-dependencies` second, so Boot's versions win.
- **Starter extras:** the starter marks some dependencies optional, so add them explicitly:
  - `spring-boot-starter-security` (method security plus a `UserDetailsService`);
  - `spring-boot-starter-jdbc` or `spring-boot-starter-data-jpa`;
  - `spring-boot-starter-json` or `spring-boot-starter-web`.

## Consequences

- **Build setup:** `scripts/setup-jdk.sh` installs Temurin 25 locally for contributors, and CI pins Temurin 25.
- **Upgrades:** moving to Activiti 9.1 or Boot 4 later means rerunning `compat-check` and the verification harness. No code should depend on 9.1-only features (for example `set-variables.EXECUTE`).

## Revision 2026-10-27: Activiti 8.8.1 on JDK 21 is a second, permanently tested target

The decision above stays: **Activiti 9.0.0 on JDK 25 is the main target.** Activiti 8.8.1 (the last 8.x) on JDK 21 is added next to it as a
second target that every CI run tests. Evidence: the jars of both releases were compared class by class, and the whole corpus runs on both
([engine findings](../engine-findings.md#activiti-881-next-to-900)).
The two engines have the same API in every class we use, and the whole seed corpus and the generated corpus give the same results on both
(not one oracle difference), so there is nothing to fork.

| Item | Main target | Second target |
|---|---|---|
| Activiti | 9.0.0 | 8.8.1 |
| JDK to build and run | 25 | 21 |
| Spring Boot | 3.5.16 (and 3.5.7) | 3.5.16 (what ships) and 3.5.7 (Activiti 8.8.1's own baseline, a compatibility run) |
| Maven | default | `-Pactiviti8` |
| Scripts | default | `ACTIVITI_LINE=8` (`setup-jdk.sh`, `env.sh`, `verify-all.sh`, `compat-check/run-matrix.sh`) |
| CI | job `verify` (Boot 3.5.16 and 3.5.7) | job `verify-activiti8` (Boot 3.5.16 and 3.5.7) |

**What changed in the build**
- **Bytecode:** every module compiles with `--release 21` (property `java.release`, formerly `java.version`, which collides with the JVM property
  the enforcer reads). The jars users embed (`activiti-runtime-rest-core`, `activiti-runtime-rest-dev`, `activiti-dmn-connector`,
  `activiti-dmn-connector-kie`, `activiti-scenario-runner`) therefore run on both stacks, and CI tests them on both. `--release 21`
  also makes the compiler reject JDK 22 to 25 APIs, so the guarantee cannot erode unnoticed.
- **Enforcer:** the default build still demands JDK 25, because Activiti 9.0.0 is Java 25 bytecode. `-Pactiviti8` sets `activiti.version=8.8.1` and
  accepts JDK 21 or newer.
- **Tests:** the two tests that asserted the engine report read the expected version from `expected.activiti.version` (surefire, from
  `${activiti.version}`) and compare the JVM with the profile's minimum. No other test depends on the engine version.

**Limits**
- **What is promised:** the library jars, the scenario runner, the harness and the corpus oracles work on both engines. Nothing else is.
- **What stays on 9.0.0:** the modeler server, the desktop bundles and the Docker image. They carry their own runtime, so a user of the
  8.8.1 line needs no bundle, and building an 8.8.1 variant of them would be a product we do not offer until someone asks. The server does
  start on JDK 21 with 8.8.1, but that is not a supported configuration. The Playwright suites test the app and the
  server on 9.0.0 only, so the 8.8.1 CI job does not run them.
- **The two engines are not the same engine:** [engine-findings.md](../engine-findings.md#activiti-881-next-to-900) lists the differences found
  (a wrong-result `TaskQuery` bug in 9.0.0, and a database schema version that makes a database written by 8.8.1 unreadable by 9.0.0). Neither
  is touched by the project's code or the corpus.
- **No version-specific scenario guards.** The scenario format has no way to say "only on 9.x", and adding one touches the schema, the Java
  loader, the TypeScript types and the docs. The design, for the first real difference between the lines: engine version detection, an
  optional guard on a file, scenario or decision case, reported as skipped and counted separately, variants as two scenarios with disjoint
  guards, and a check against silent drift. Without a difference there is nothing to guard; the CI jobs of both lines keep one from hiding.
- **Not tested:** databases other than H2, clustering, and Activiti 9.0.0 on JDK 21 (impossible: Java 25 bytecode). The 8.8.1 job runs Spring Boot 3.5.16 and 3.5.7.
- **Still true:** 9.1 or Spring Boot 4 later means rerunning `compat-check` and the harness on both lines.
