# ADR 0009: One modeler, two artifacts: an embeddable starter and the standalone server

- Status: Proposed. Only the publishing part is built (see the implementation notes); the starter is not.
- Date: 2026-10-28

## Context

The published modeler should serve two kinds of user:
- **download and run:** a standalone jar to create BPMN and DMN (ADR 0008);
- **add it to the pom** of their own Spring Boot app: the app then serves the modeler UI over its own deployed processes, read-only or for editing, chosen by Spring properties.

Two facts shape how:
- **An executable Spring Boot jar cannot be a dependency.** Its classes are under `BOOT-INF/classes`, which a host application's class loader does not see.
- **Deploying a model is running code (ADR 0007).** A deployed BPMN can run a script task, a shell task, `activiti:class` or a JUEL expression that calls any bean. A deploy endpoint inside a production app is remote code execution for whoever reaches it.

## Decision

- **`activiti-modeler-spring-boot-starter`**: a plain jar for the host app's pom. It carries the modeler UI as static resources and an auto-configuration that serves it at `activiti.modeler.path` (default `/activiti-modeler`).
  - `activiti.modeler.mode=view` (the default): the processes and decisions the host has deployed, read-only. The model source is `activiti-runtime-rest-core`, which already serves `/process-definitions/{id}/xml`, `/extensions` and `/decisions`.
  - `activiti.modeler.mode=edit`: full modeling in the browser, starting from a deployed definition or a new file. The work is stored in the browser and exported as a zip for the app's `src/main/resources`. **Nothing is written to or deployed on the server.**
  - Security is the host's: the starter contributes no `SecurityFilterChain` and maps its roles through properties, as `activiti-runtime-rest-core` does (ADR 0007).
  - **It depends on `activiti-runtime-rest-core` only, never on `activiti-runtime-rest-dev`.** A rule of the Maven enforcer plugin (`bannedDependencies`) on the starter module fails the build if `activiti-runtime-rest-dev` reaches its dependency tree. Code that is not in the application cannot be switched on by a property set by mistake.
- **`activiti-modeler-server`**: the standalone modeler, built from the starter plus `activiti-runtime-rest-dev` (validate, deploy, scenario run, workspace files) and its own development security (ADR 0007). It is the only artifact that can deploy from the UI. It ships as the downloads of ADR 0008 and on Maven Central as the classifier `exec` (the repackaged, runnable jar) next to the plain jar.
- **A team that wants deploy-from-UI in its own development environment** adds `activiti-runtime-rest-dev` to its pom explicitly: a visible choice in code review and in dependency scans.
- **An operations cockpit, if one is built, joins the same starter** behind `activiti.cockpit.enabled` (default `false`), instead of a separate `activiti-cockpit-spring-boot-starter`. The view mode is already half of a cockpit: the diagram viewer, the deployed definitions, `activiti-runtime-rest-core` and the same security model.
- **Publishing:** Maven Central through the Sonatype Central Portal, namespace `io.github.kleash`, signed with GPG, from the release workflow, and only on the maintainer's explicit run as the last step of a release (see the implementation notes). JitPack is not used.

## Consequences

- What ships does not change: the standalone server, the desktop bundles, Docker and the browser build (ADR 0008). The coordinates of the published modules stay as they are when the starter is added.
- Building the starter needs a read-only mode of the app (no palette, a read-only properties panel, no save), a model source backed by the host, the auto-configuration, and tests that embed the starter in a sample Spring Boot app in both modes.
- The integration guide lists only what is built, so it has no row for the starter.

## Implementation notes: publishing

How publishing was built, and where it differs from the text above. Details are in the [developer guide](../developer-guide.md#maven-central-adr-0009).

- **Never implicit.** A version on Central cannot be changed or removed, so having the secrets set is not enough to upload.
  - Every run of the release workflow builds, signs and bundles the Maven artifacts, and the GitHub Release waits for that.
  - Only a separate run uploads: the maintainer's run on the tag, with `publish_maven_central` on, after the tag's GitHub Release.
  - The deployment is then published by hand in the Central Portal (`autoPublish` off).
- **Published:** the parent pom, which every module inherits from, the five libraries and the server. `verification-harness` is not published.
  - The server's runnable jar is its classifier `exec` in every build, not only for Central, so the plain jar is the main artifact.
  - The downloads, the Dockerfile and the scripts take `-exec.jar`.
- **The Alfresco repository stays in the published parent pom.** Central discourages `<repositories>` in a pom but accepts them, and Activiti 8.x and 9.x exist nowhere else. Reading any module's pom needs the `activiti-dependencies` BOM that the parent imports. With the repository in the parent, a host resolves the modules from Central with no repository of its own; it still needs the Alfresco repository for Activiti itself.
- **Signing** uses the Bouncy Castle signer of `maven-gpg-plugin`. The key is in an environment variable of the one Maven step. The npm build of the web app runs in an earlier step, without secrets.
