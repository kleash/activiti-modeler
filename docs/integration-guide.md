# Integration guide

How to run what the modeler exports in your own Spring Boot 3.5.x application.

## What your application needs

The modeler exports a project folder (or zip) that drops into `src/main/resources/` of a Spring Boot app:

- `processes/*.bpmn20.xml`: plain BPMN 2.0 with `activiti:` attributes;
- `processes/*-extensions.json`: the variables, mappings and constants Activiti 7+ reads next to each process;
- `processes/*.dmn`: DMN 1.3, when the project has decisions.

Running these needs **only Activiti's own starter**, `org.activiti:activiti-spring-boot-starter`, plus the properties in [Configure Activiti](#2-configure-activiti-and-the-connector). Nothing from this project is required.

**The one exception: DMN decision tasks.** The open-source Activiti runtime (7 and later) has no DMN engine. A project whose processes call decisions adds one dependency, [`activiti-dmn-connector`](#dmn), which evaluates the decisions. A project without decision tasks does not need it.

Everything else this repository builds is optional or internal:

| Module | What it is | Do you need it? |
|---|---|---|
| `activiti-dmn-connector` | DMN engine for decision tasks (Operaton DMN) | only if your processes use decision tasks |
| `activiti-dmn-connector-kie` | the KIE DMN engine instead, for boxed expressions and business knowledge models | only if your DMN needs them |
| `activiti-scenario-runner` | runs the modeler's `*.scenario.json` files in your own JUnit tests | optional, for testing |
| `activiti-runtime-rest-core` | a REST API over the running engine | optional |
| `activiti-runtime-rest-dev`, `activiti-modeler-server` | the modeler's own server (deploy, run scenarios, workspace) | no: development tool, never in production |

All of them are on **Maven Central**, from release 0.1.0, under the group `io.github.kleash.activiti`, with sources, javadoc and GPG signatures (key `4D40 5980 71E2 EB02 FB51 46DE 86B0 7E0A 07D6 BFAE`). For the server, the classifier `exec` is the runnable jar of the downloads. Your pom needs no repository for these modules.

Targets: Activiti 9.0.0 on JDK 25 (main) and Activiti 8.8.1 on JDK 21 (second, equally tested), both on Spring Boot 3.5.x. Which one to take is the next section. The snippets show 9.0.0; for 8.8.1 change the Activiti version to `8.8.1`.

Activiti 8.x and 9.x themselves are only published to the Alfresco repository, so your pom needs it for `activiti-spring-boot-starter`:

```xml
<repositories>
  <repository>
    <id>activiti-releases</id>
    <url>https://artifacts.alfresco.com/nexus/content/repositories/activiti-releases/</url>
    <snapshots><enabled>false</enabled></snapshots>
  </repository>
</repositories>
```

The modules' parent pom names the same repository, because it imports Activiti's BOM. If a repository manager mirrors every repository for you, it must proxy this one too.

## Which Activiti line: 8.8.1 on JDK 21 or 9.0.0 on JDK 25

Choose by the JDK your application runs on. **Activiti 9.0.0 is compiled to Java 25 bytecode and cannot start on an older JDK**; Activiti 8.8.1 is Java 21 bytecode.

| Your JDK | Activiti | Spring Boot | Tested here |
|---|---|---|---|
| 25 | **9.0.0** (latest) | 3.5.x, the latest (3.5.16 today) | 3.5.16 (what ships) and 3.5.7 |
| 21 (also runs on 25) | **8.8.1** (the last 8.x) | 3.5.x, the latest (3.5.16 today) | 3.5.16 (what ships) and 3.5.7, Activiti 8.8.1's own baseline |

- **One set of jars.** The optional modules above (`activiti-dmn-connector` and the others) are compiled to Java 21 bytecode and bundle no Activiti, so the same jars run on both lines. Only the Activiti version in your own pom (`org.activiti:activiti-spring-boot-starter`, or the `activiti-dependencies` BOM) changes. There is no `-activiti8` variant of anything.
- **The same exported project runs on both.** The BPMN, `<process>-extensions.json`, DMN files and scenarios the modeler writes do not depend on the line. The whole hand-written seed corpus and the corpus generated through the modeler are verified on both engines with the same oracles, and not one result differs. The `activiti` field of `project.json` says `9.0.0`; it is a label, and the project runs unchanged on 8.8.1.
- **The modeler server, the desktop bundles and the Docker image run on 9.0.0 and JDK 25.** They carry their own runtime, so you need neither a separate JDK nor a choice. The 8.8.1 line is for applications that embed the libraries above.
- **Building this repository for 8.8.1:** `ACTIVITI_LINE=8 scripts/setup-jdk.sh`, then `ACTIVITI_LINE=8 scripts/verify-all.sh`, or `mvn -Pactiviti8 verify` in `java/`, on Spring Boot 3.5.16 like every shipped build; add `BOOT_VERSION=3.5.7` (or `-Dspring-boot.version=3.5.7`) for Activiti 8.8.1's own baseline, which is a compatibility run and not a combination to deploy ([ADR 0002](adr/0002-runtime-target.md)).

**Warning: the database.** Activiti 8.8.1 stamps schema version `8.1.5` and Activiti 9.0.0 `8.1.4`, and **9.0.0 refuses to open a database that 8.8.1 has created or even started on** (`unknown version from database: '8.1.5'`). In the other direction 8.8.1 opens a 9.0.0 database and upgrades it in place, after which 9.0.0 cannot open it either. So:
- moving an application from 8.8.1 to 9.0.0 needs a new, empty database (or a migration of your own); there is no switch to make the old one readable;
- do not point both lines at the same file or production database, and do not try the other line on a database you still need: opening it can change it for good. Take a backup first;
- an in-memory database (the default of the examples) is not affected.

**Warning: one query bug on 9.0.0.** A `TaskQuery` that filters by a process variable value and by anything else returns wrong tasks on 9.0.0 (the filters are OR-ed), and is correct on 8.8.1. Nothing in this project does that, but a host application on 9.0.0 must not. Details: [engine findings](engine-findings.md#activiti-881-next-to-900).

## Security: Spring Boot 3.5.16 ships vulnerable versions; pin these in your app

**These vulnerabilities come from Spring Boot, not from this project's modules.** Spring Boot 3.5.16 itself manages vulnerable versions of Jackson, Tomcat, Log4j, `commons-lang3` and (through Activiti) Jakarta Mail, so any application on it carries them, with or without our jars. What an exported project needs is only `activiti-spring-boot-starter`, plus `activiti-dmn-connector` if it uses decision tasks ([above](#what-your-application-needs)); neither can force a safe version on your application, because the parent pom's `dependencyManagement` is not inherited by a host: **your** BOM decides which Jackson, Tomcat or Log4j you get. So: **use the latest Spring Boot 3.5.x (3.5.16 today), not an older 3.5.x** (the baseline scan of 3.5.7, Activiti 8.8.1's own baseline, found 44 more findings than 3.5.16: old Tomcat, Spring Framework, Spring Security, Logback and Spring Boot itself), and **pin the versions below in your own pom**. This project's server and libraries are built with exactly these overrides (`java/pom.xml`, checked by the OSV scan on every change). All are patch or minor steps inside the line Spring Boot 3.5 manages.

In your pom, put the two BOM imports **before** Spring Boot's (the first import wins), and the direct entries anywhere in `dependencyManagement` (they win over every import). This works the same whether your parent is `spring-boot-starter-parent` or you import `spring-boot-dependencies`:

```xml
<dependencyManagement>
  <dependencies>
    <!-- these two BOMs first, so they beat the versions Spring Boot manages -->
    <dependency>
      <groupId>com.fasterxml.jackson</groupId><artifactId>jackson-bom</artifactId><version>2.21.8</version>
      <type>pom</type><scope>import</scope>
    </dependency>
    <dependency>
      <groupId>org.apache.logging.log4j</groupId><artifactId>log4j-bom</artifactId><version>2.25.5</version>
      <type>pom</type><scope>import</scope>
    </dependency>
    <!-- your Spring Boot BOM (3.5.16) and the Activiti BOM, as before -->

    <!-- no BOM to import for these: direct entries -->
    <dependency><groupId>org.apache.tomcat.embed</groupId><artifactId>tomcat-embed-core</artifactId><version>10.1.61</version></dependency>
    <dependency><groupId>org.apache.tomcat.embed</groupId><artifactId>tomcat-embed-el</artifactId><version>10.1.61</version></dependency>
    <dependency><groupId>org.apache.tomcat.embed</groupId><artifactId>tomcat-embed-websocket</artifactId><version>10.1.61</version></dependency>
    <dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId><version>3.18.0</version></dependency>
    <dependency><groupId>com.sun.mail</groupId><artifactId>jakarta.mail</artifactId><version>2.0.2</version></dependency>
  </dependencies>
</dependencyManagement>
```

| Override | Instead of (Spring Boot 3.5.16 / Activiti) | Why |
|---|---|---|
| `jackson-bom` 2.21.8 | 2.21.4 | eleven advisories in `jackson-core` and `jackson-databind`; also the newest 2.21 patch |
| `tomcat-embed-*` 10.1.61 | 10.1.55 | three critical advisories (DIGEST and FORM authentication, security constraints); only if you use the embedded Tomcat |
| `log4j-bom` 2.25.5 | 2.24.3 | `log4j-api` (only the bridge to SLF4J is on the class path) |
| `commons-lang3` 3.18.0 | 3.17.0 | uncontrolled recursion in `ClassUtils.getClass` |
| `com.sun.mail:jakarta.mail` 2.0.2 | 2.0.1 (via Activiti's `commons-email2-jakarta`) | SMTP injection; affects mail tasks |

Drop an entry when your Spring Boot BOM manages that version or a newer one. Do not "fix" it by moving to Spring Framework 7, Spring Boot 4 or Tomcat 11: no stable Activiti release runs on them.

**What has no usable fix.** Three advisories have no fix that runs with Activiti. Do not bump `mybatis`: 3.5.19 embeds a repackaged OGNL 3.4.4 (GHSA-crwc-vw2r-qr6m, CVE-2026-113730, a hardening bypass that matters only to applications that evaluate attacker-controlled OGNL; no Maven SBOM lists it, a scan of the jar or image does), and MyBatis 3.6.0, which embeds the fixed OGNL, is binary incompatible with `activiti-engine` 9.0.0 and 8.8.1 (the engine fails to start with `NoSuchMethodError TypeHandlerRegistry.register`). And Spring Framework 6.2.19, the last open-source 6.2.x, has two advisories (`spring-webmvc`: GHSA-pc63-qcmh-9cmg / CVE-2026-47884, `XsltView` SSRF; GHSA-j9f9-w8pj-32f8 / CVE-2026-47890, Server-Sent Events with view fragments) whose fix is only in the Enterprise-only 6.2.20 or in Spring Framework 7. They need XSLT views or SSE with view fragments, which this project's server does not use ([the statement](security/vex.openvex.json), [SECURITY.md](../SECURITY.md)). If **your** application renders XSLT views, streams view fragments over SSE, or feeds untrusted text to OGNL (for example through custom MyBatis mappers built from user input), you are affected: decide for yourself. Spring Boot 4 is an option only once a stable Activiti release supports it.

## DMN

Activiti 9 OSS has no DMN engine. `activiti-dmn-connector` adds one as an Activiti `Connector`: a **decision task** is a service task whose implementation is `dmn-connector.EXECUTE_TABLE`. The decision is named by a constant, evaluated with the task's input variables, and its results reach the process through the task's output mappings. Design: [ADR 0004](adr/0004-dmn-execution.md). The DMN files the modeler writes follow [the portable DMN conventions](user-guide/dmn-conventions.md).

### 1. Add the dependency

```xml
<dependencies>
  <dependency>
    <groupId>org.activiti</groupId>
    <artifactId>activiti-spring-boot-starter</artifactId>
    <version>9.0.0</version>
  </dependency>
  <!-- ProcessRuntime and TaskRuntime need Spring Security; the extensions JSON reader needs Jackson -->
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-json</artifactId>
  </dependency>

  <dependency>
    <groupId>io.github.kleash.activiti</groupId>
    <artifactId>activiti-dmn-connector</artifactId>
    <version>0.1.0</version>
  </dependency>
  <!-- optional: the KIE engine (business knowledge models, boxed expressions, decision services) -->
  <dependency>
    <groupId>io.github.kleash.activiti</groupId>
    <artifactId>activiti-dmn-connector-kie</artifactId>
    <version>0.1.0</version>
  </dependency>
</dependencies>
```

The connector registers itself through Spring Boot auto-configuration (`DmnConnectorAutoConfiguration`). It declares Operaton DMN 2.2.0, `org.camunda.feel:feel-engine:1.20.0` and `scala-library:2.13.18` as direct dependencies, so a host gets those versions without managing them. Operaton's own default, feel-engine 1.22.1, drags in `jackson-module-scala 2.22.1`, which refuses to run on the Jackson 2.19 to 2.21 of Spring Boot 3.5 when the Boot BOM is not applied. Inside a Boot application the BOM aligns `jackson-module-scala` with `jackson-databind` either way.

### 2. Configure Activiti and the connector

```properties
# Mandatory for the modeler's runtime features (history is the source of the "path" of an instance)
spring.activiti.history-level=full
spring.activiti.db-history-used=true
spring.activiti.deployment-mode=default

# The .dmn files must be deployed together with the BPMN: add **.dmn to the suffixes
spring.activiti.process-definition-location-suffixes=**.bpmn20.xml,**.bpmn,**.dmn

# Connector (all optional)
activiti.dmn.engine=operaton       # operaton (default) or kie
activiti.dmn.cache-size=256        # parsed documents, resolved deployments, process definition lookups
activiti.dmn.enabled=true          # false: do not register dmn-connector.EXECUTE_TABLE
```

Keep the `.dmn` files **directly** in the folder that holds the BPMN (default `src/main/resources/processes/`). Spring's `**.dmn` pattern does not descend into sub folders. In `deployment-mode=default` the whole folder is one deployment, all or nothing, and Spring stores **absolute file paths** as resource names; the connector compares only the last path segment. Alternatively deploy the DMN programmatically with the BPMN in the same deployment (`repositoryService.createDeployment().addString("risk.dmn", ...)`), the process then finds it by the same rules.

### 3. Model the decision task

BPMN: a service task with `implementation="dmn-connector.EXECUTE_TABLE"`. Never a `businessRuleTask` (Activiti 9 fails at deployment with an NPE for it).

```xml
<serviceTask id="decideRisk" name="Decide risk" implementation="dmn-connector.EXECUTE_TABLE" />
```

`<process>-extensions.json`, next to the BPMN, names the decision and wires the variables:

```json
{
  "id": "riskProcess-extensions",
  "extensions": {
    "riskProcess": {
      "properties": {
        "Property_amount":  { "id": "Property_amount",  "name": "amount",  "type": "integer" },
        "Property_risk":    { "id": "Property_risk",    "name": "risk",    "type": "string" },
        "Property_matched": { "id": "Property_matched", "name": "matched", "type": "boolean" }
      },
      "constants": {
        "decideRisk": { "_activiti_dmn_table_": { "value": "priorityRisk" } }
      },
      "mappings": {
        "decideRisk": {
          "inputs":  { "amount": { "type": "variable", "value": "amount" } },
          "outputs": {
            "risk":    { "type": "variable", "value": "risk" },
            "matched": { "type": "variable", "value": "_activiti_dmn_matched_" }
          }
        }
      }
    }
  }
}
```

### 4. How the decision is found

The value of the constant `_activiti_dmn_table_` is resolved against the `.dmn` resources of the **process definition's own deployment**, in this order. A step that matches more than one candidate fails with an error that lists them; a matching step never falls through to the next.

1. **Resource base name**: the file name without directory and `.dmn`, for example `risk-model` for `.../processes/risk-model.dmn`. It selects that file's *sink decision*, the one no other decision of the file requires. (This is the Alfresco Process Automation convention.)
2. **`definitions/@name`** of a DMN file; also selects that file's sink decision.
3. **A decision id** in any DMN file of the deployment. This is what the modeler writes, because it is unambiguous.

A file with several unrelated decisions has several sinks: reference one of them by decision id.

Parsed documents are cached per deployment id and resource.

### 5. Inputs and outputs

**Inputs.** The decision's inputs are the task's mapped input variables plus its constants, without the reserved constants whose names start with `_activiti_`. Variables of the Activiti `json` type are converted to plain maps and lists. Without an input mapping the decision gets no inputs.

**Outputs.** The connector always produces these outbound variables:

| Outbound variable | When | Value |
|---|---|---|
| `<output name>` (one per output column) | single result: UNIQUE, FIRST, ANY, PRIORITY, COLLECT with an aggregator; literal expression (`<variable name>`) | the column value, or the aggregate. Not emitted when nothing matched or the value is `null`. COLLECT COUNT emits `0` |
| `<decisionId>` | multi result: COLLECT without aggregator, RULE ORDER, OUTPUT ORDER | a list of row maps (`[{"badge": "star"}, ...]`) in hit-policy order; an empty list when nothing matched |
| `_activiti_dmn_matched_` | always | boolean: a rule matched (literal expression: a value was produced) |
| `_activiti_dmn_matched_rules_` | always | list of the ids of the matching rules, in result order |

For a DRD (several decisions that require each other) the sink decision is evaluated together with everything it requires and only its result is exposed.

**Outputs reach the process only through output mappings.** This is how Activiti 9 works, not a choice of the connector:

- `"outputs": { "<processVar>": { "type": "variable", "value": "<connector output>" } }`; or `"mappingType": "MAP_ALL_OUTPUTS"` to take all four kinds of outbound variables as they are;
- every output target must be declared in `properties`, otherwise the engine skips it; its `type` coerces the value (`integer` for numbers, `string`, `boolean`, `array` for lists of rows and rule ids);
- without a mapping entry for the task, or without `outputs`, nothing reaches the process.

**No match.** Output columns are **not emitted**. The engine's output mapping skips missing sources, so a mapped process variable keeps its previous value. To react to "no match", map `_activiti_dmn_matched_` and branch on it:

```xml
<sequenceFlow id="flow_routed" sourceRef="isRouted" targetRef="routedEnd">
  <conditionExpression xsi:type="tFormalExpression">${matched}</conditionExpression>
</sequenceFlow>
```

A decision that fails (unknown decision, ambiguous reference, two UNIQUE rules matched, invalid DMN, a construct the engine cannot run) throws a `DmnException`. Like any service task exception it fails the Activiti command and rolls it back, unless the task is asynchronous, where it becomes a failed job.

### 6. Choose the engine

| | Operaton (default) | KIE (`activiti.dmn.engine=kie`) |
|---|---|---|
| Artifact | `activiti-dmn-connector` | add `activiti-dmn-connector-kie` |
| Weight | about 1.4 MB plus FEEL and Scala | about 50 jars incl. Drools compiler |
| Strictness | lenient (accepts dmn-js output as it is) | strict (see [conventions](user-guide/dmn-conventions.md)) |
| Hit policies | all seven (PRIORITY and OUTPUT ORDER added by the connector) | all seven natively |
| Decision tables, literal expressions, DRD | yes | yes |
| BKM, contexts, invocations, decision services | rejected with a clear error | yes |

Both give the same result rows and matched rules for portable DMN. `DmnCrossCheck` (module `activiti-dmn-connector-kie`) evaluates a document on both and reports differences:

```java
DmnCrossCheck.Result result = new DmnCrossCheck().check(new DmnResource("risk.dmn", xml), "riskDecision", inputs);
result.requireAgreement();   // throws DmnException listing the differences
```

To plug in another engine, implement `DmnEvaluator` and declare it as a bean; the auto-configuration backs off.

### 7. Evaluate a decision outside a process

`DmnEvaluationService` is a bean. The modeler server's "test decision" endpoint and the scenario runner's `decisions[]` use it.

The scenario runner (`activiti-scenario-runner`) has no DMN dependency of its own; it evaluates `decisions[]` through its `DecisionEvaluator`
port. `activiti-dmn-connector` declares the runner as an **optional** dependency and, when the runner is on the host's class path, registers
`ScenarioDecisionEvaluator`, an adapter over `DmnEvaluationService` that resolves the decision reference (file base name, model name or
decision id) in the newest deployment that has it. A host that does not use the runner gets neither the dependency nor the adapter. Define
your own `DecisionEvaluator` bean to replace it.

```java
@Autowired DmnEvaluationService decisions;

// a DMN document
DmnEvaluation byXml = decisions.evaluateXml(dmnXml, "priorityRisk", Map.of("amount", 2000));

// a deployment: base name, definitions name or decision id
DmnEvaluation byDeployment = decisions.evaluateInDeployment(deploymentId, "loan-decision", Map.of("age", 30, ...));

byDeployment.rows();           // [{offer=APPROVE}]
byDeployment.matchedRules();   // [loanOffer_approve]
byDeployment.decision("riskClass").matchedRules();   // results of the decisions it required
```

### 8. Troubleshooting

| Symptom | Cause |
|---|---|
| `NoSuchBeanDefinitionException: dmn-connector.EXECUTE_TABLE` | `activiti-dmn-connector` is not on the classpath, or `activiti.dmn.enabled=false`. |
| `Deployment ... contains no .dmn resource` | `**.dmn` is missing from `spring.activiti.process-definition-location-suffixes`, or the file is in a sub folder. |
| The decision runs but the process variable stays empty | No output mapping for the task, or the target is not declared in `properties`, or nothing matched. Map `_activiti_dmn_matched_` and `_activiti_dmn_matched_rules_` to see. |
| `'x' is ambiguous: it matches the resource base name of 2 DMN resources` | Two files with the same name in different folders of one deployment. Reference the decision by id. |
| `activiti.dmn.engine=kie is not available` | The KIE module is not on the classpath. |
| `... requires a business knowledge model ... Set activiti.dmn.engine=kie` | The decision uses a construct only KIE runs. |
| Matches nothing although the table looks right | A misspelled input mapping: a missing input is `null` and comparisons with `null` do not match. |

## Runtime REST core in a host application

`activiti-runtime-rest-core` is the REST API of the Activiti 9 runtime: engine report, deployments, process definitions (BPMN, extensions, decisions), instances (state, path, variables, child instances), tasks, messages, signals, jobs, timers and dead letters. The endpoints are listed in [`api/runtime-rest.md`](api/runtime-rest.md), the machine-readable description is [`api/openapi-core.json`](api/openapi-core.json). Design: [ADR 0007](adr/0007-runtime-rest-split-and-security.md).

**What it is not:** it does not authenticate anybody, it contributes **no** `SecurityFilterChain`, and it never deploys models, runs scenarios or touches files (those are the dev endpoints, [`activiti-runtime-rest-dev`](user-guide/modeler-server.md), which a production application must not add).

### 1. Add the dependency

The library declares everything the host brings (Activiti, Spring Web, Spring Security, JDBC, springdoc) as `provided`, so it adds nothing to your dependency tree. Your application needs:

```xml
<dependency>
  <groupId>org.activiti</groupId>
  <artifactId>activiti-spring-boot-starter</artifactId>
  <version>9.0.0</version>
</dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-security</artifactId></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-jdbc</artifactId></dependency>

<dependency>
  <groupId>io.github.kleash.activiti</groupId>
  <artifactId>activiti-runtime-rest-core</artifactId>
  <version>0.1.0</version>
</dependency>
<!-- optional: with it the engine report names the DMN engine and /process-definitions/{id}/decisions lists the decisions -->
<dependency>
  <groupId>io.github.kleash.activiti</groupId>
  <artifactId>activiti-dmn-connector</artifactId>
  <version>0.1.0</version>
</dependency>
```

The auto-configuration (`RestCoreAutoConfiguration`) applies to servlet web applications that have `ProcessRuntime` and `TaskRuntime` on the classpath. `activiti.rest.enabled=false` switches it off.

### 2. Properties

```properties
# Mandatory: the application does not start without them (a failure analyzer names the two properties)
spring.activiti.history-level=full
spring.activiti.db-history-used=true
spring.activiti.deployment-mode=default
spring.activiti.process-definition-location-suffixes=**.bpmn20.xml,**.bpmn,**.dmn

# Where the API lives
activiti.rest.base-path=/api

# Which authorities reach which level (lists of granted-authority strings; a higher level includes the lower ones)
activiti.rest.roles.read=ROLE_ACTIVITI_USER
activiti.rest.roles.operate=ROLE_ACTIVITI_USER
activiti.rest.roles.admin=ROLE_ACTIVITI_ADMIN

# Optional
activiti.rest.default-page-size=20
activiti.rest.max-page-size=200
activiti.rest.expose-bean-names=true       # GET /engine lists the Spring beans a JUEL expression can use; switch off if that is too much to show
activiti.rest.sequence-flows.max-instances=5000
activiti.rest.sequence-flows.max-flows-per-instance=2000
spring.mvc.problemdetails.enabled=true     # 405, 415 and unknown paths as problem+json, like the library's own errors
```

The history settings are not a preference. The path of an instance, the variables of ended instances and the variable history are read from the history tables, and Activiti's defaults are history level `NONE` with no history tables at all. `HistorySettingsCheck` stops the start when the engine does not keep `full` history in the database.

**Taken sequence flows.** Activiti does not record which sequence flows an instance took (history has activities only). The library registers an event listener (`SEQUENCEFLOW_TAKEN`) that keeps the flows per instance in memory, bounded by the two `sequence-flows` properties. `GET /process-instances/{id}/path` says `sequenceFlowsSource: recorded` for such an instance and `inferred` (derived from the model and the activities visited) for one the listener did not see, for example after a restart. Provide your own `SequenceFlowTracker` bean to replace the recorder.

### 3. Roles and who is the actor

Every endpoint needs one of three access levels:

| Level | Property | Default | Meaning |
|---|---|---|---|
| read | `activiti.rest.roles.read` | `ROLE_ACTIVITI_USER` | look at everything |
| operate | `activiti.rest.roles.operate` | `ROLE_ACTIVITI_USER` | start instances, claim / release / complete tasks, send messages and signals, manage instances, jobs |
| admin | `activiti.rest.roles.admin` | `ROLE_ACTIVITI_ADMIN` | reassign any task, purge the history of an ended instance |

Map your own roles by setting the lists, for example for an operations UI with a read-only auditor role:

```properties
activiti.rest.roles.read=ROLE_AUDITOR,ROLE_OPERATOR,ROLE_ACTIVITI_USER
activiti.rest.roles.operate=ROLE_OPERATOR,ROLE_ACTIVITI_USER
activiti.rest.roles.admin=ROLE_PLATFORM_ADMIN
```

The check is an interceptor that runs after your security filters: no `Authentication` gives 401, one without the authority 403. **The acting user is always the authenticated principal.** No request body or parameter names a user (a `user` member in a body is a 400), so nobody can act as somebody else through the API. A filter registered for the base path sets `org.activiti.engine.impl.identity.Authentication.setAuthenticatedUserId(principal)` for the request and clears it in a `finally`, so `activiti:initiator` and the task history work for starts through the API.

Candidate groups: Activiti's runtimes read the groups of a user from the host's `UserDetailsService` (`ExtendedInMemoryUserDetailsManager` or your own `UserGroupManager` / `UserRoleManager`; a `GROUP_<name>` authority makes the user a member of the group `<name>`). A task that the principal may not see answers 404.

### 4. Host security (your responsibility)

The library says what authority an endpoint needs; **it never decides how a caller authenticates**. You add a `SecurityFilterChain` that protects the base path. A minimal one for a session based host:

```java
@Bean
SecurityFilterChain api(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(a -> a.anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()))   // or httpBasic(), formLogin(), ...
        .build();
}
```

What you decide and the library does not: authentication (sessions, OAuth2, Basic), CSRF (for cookie based callers keep Spring's CSRF protection on, the TypeScript client sends the `X-XSRF-TOKEN` header), CORS, TLS, rate limits, audit logging, and the network the application listens on. If you forget the chain the library still answers 401 to anonymous callers (no `Authentication` in the context), but a host with a catch-all `permitAll()` plus an anonymous token with roles would grant what you configured; keep anonymous users away from the roles above.

### 5. Errors, lists, OpenAPI

Errors are `application/problem+json` with `engineException` and `rootCause` members; lists take `page` and `size` and answer `{ items, page, size, total }`; bodies are DTOs and unknown members are refused (400). To publish the OpenAPI description add `springdoc-openapi-starter-webmvc-api` and set `springdoc.packages-to-scan=io.github.kleash.activiti`.

### 6. Troubleshooting

| Symptom | Cause |
|---|---|
| The application does not start: "The runtime REST API needs full history in the database" | The two history properties above are missing. |
| Every call answers 401 although you are signed in | Your chain does not cover the base path, or the authentication is not in the `SecurityContext` when the interceptor runs (a custom filter after `FilterSecurityInterceptor`). |
| 403 with a text that names the authorities | The user's authorities are not in `activiti.rest.roles.*`; the message prints both. |
| A task or instance answers 404 although it exists | `TaskRuntime` and `ProcessRuntime` show a user only what concerns that user: starter, assignee, candidate user or candidate group. Check the user's `GROUP_` authorities. |
| `path` has no sequence flows after a restart | The recorder is in memory; they are `inferred` from the model for such instances. |
| No `/api/dev/...` endpoints | By design: they exist only with `activiti.rest.dev.enabled=true` and the dev module on the classpath. |
