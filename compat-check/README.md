# Activiti embedded-in-Spring-Boot compatibility check

A minimal Spring Boot app that embeds Activiti through `activiti-spring-boot-starter` in its `pom.xml`. Its tests deploy a BPMN process from `classpath:processes/` and run it through `ProcessRuntime`/`TaskRuntime`.

The process covers:
- a connector-backed service task
- a `delegateExpression` service task
- a JUEL script task
- an exclusive gateway with a default flow
- a candidate-group user task with a priority
- `activiti:initiator`

## Where Activiti is published (checked 2026-10-26)

| Repository | Latest `org.activiti:activiti-spring-boot-starter` |
|---|---|
| Maven Central (`repo1.maven.org`) | **7.1.0.M6** (Feb 2020). Nothing newer has been published there. |
| Alfresco Nexus `activiti-releases` | **9.0.0** latest GA (8.x ends at 8.8.1); **9.1.0-alpha.99** latest pre-release |

You must add the Alfresco repository to use any 8.x/9.x release:

```xml
<repository>
  <id>activiti-releases</id>
  <url>https://artifacts.alfresco.com/nexus/content/repositories/activiti-releases/</url>
</repository>
```

## Baselines

| Activiti | Built against Spring Boot | Bytecode | Minimum JDK |
|---|---|---|---|
| 8.8.1 | 3.5.7 | class v65 | 21 |
| 9.0.0 | 3.5.7 | class v69 | **25** |
| 9.1.0-alpha.99 | 4.0.7 | class v69 | **25** |

## Supported targets

**Main target: Activiti 9.0.0 (latest stable) on Spring Boot 3.5.x, JDK 25.** The modeler's verification harness targets this.
**Second, permanently tested target: Activiti 8.8.1 (the last 8.x) on JDK 21**, Spring Boot 3.5.7 (its own baseline). See
[ADR 0002](../docs/adr/0002-runtime-target.md) and [`docs/engine-findings.md`](../docs/engine-findings.md#activiti-881-next-to-900).

| Activiti | Spring Boot | JDK | Result (H2 in-memory) |
|---|---|---|---|
| 9.0.0 | 3.5.16 (latest 3.5.x) | 25.0.5 | ✅ 3/3 tests |
| 9.0.0 | 3.5.7 (Activiti's own baseline) | 25.0.5 | ✅ 3/3 tests |
| 8.8.1 | 3.5.7 (Activiti's own baseline) | 21.0.13 | ✅ 3/3 tests |

Re-run it with `./run-matrix.sh`. Each row runs on its own JDK, so the script looks for one per row: `<repo>/.tools/jdk-<major>`
(`scripts/setup-jdk.sh`; `ACTIVITI_LINE=8 scripts/setup-jdk.sh` installs 21), then `JAVA_HOME_<major>_X64` (GitHub runners), then
`JAVA_HOME` and the `java` on the PATH (25 means 25 or newer, 21 exactly 21).
- `./run-matrix.sh` runs every row. A missing JDK 25 is a `FAIL`; a missing JDK 21 prints `SKIP` for the 8.8.1 row, so a machine that has only JDK 25 can still run the main rows;
- `ACTIVITI_LINE=8 ./run-matrix.sh` runs only the 8.8.1 row, and a missing JDK 21 is a `FAIL`;
- `ACTIVITI_LINE=9 ./run-matrix.sh` runs only the 9.0.0 rows (JDK 25).

A single combination by hand: `JAVA_HOME=<jdk-21> mvn clean verify -Dactiviti.version=8.8.1 -Dspring-boot.version=3.5.7`. The app is
compiled to Java 21 bytecode (`java.release`), so the same sources serve both lines.

### Why not Spring Boot 4?

9.0.0 fails to start on Spring Boot 4.1.2. The exception is `NoClassDefFoundError: org/springframework/boot/autoconfigure/cache/CacheManagerCustomizer`, because Boot 4 moved that class into the `spring-boot-cache` module. Only the 9.1.0 alpha builds target Boot 4, and they are not stable releases.

## Findings that matter for a modeler

1. **Connector outputs need an extensions file.** With no mapping for the task in `<process>-extensions.json`, the output variables of a service task with `implementation="<connectorBean>"` are silently dropped (`ExtensionsVariablesMappingProvider.calculateOutPutVariables`). See `src/main/resources/processes/compat-check-extensions.json`.
2. **`activiti:initiator` is not filled in automatically.** `ProcessRuntime` does not copy the Spring Security user into the engine's `Authentication` thread-local. The host application must call `Authentication.setAuthenticatedUserId(...)`.
3. **The default Spring Security setup is enough.** `ProcessRuntime`/`TaskRuntime` need an authenticated user with `ROLE_ACTIVITI_USER`. Groups are given as `GROUP_<name>` authorities, and those groups are matched against `activiti:candidateGroups`.
