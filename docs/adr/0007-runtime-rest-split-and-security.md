# ADR 0007: Split the runtime REST layer into a core part and a dev part; libraries never own security

- Status: Accepted
- Date: 2026-10-26

## Context

Two consumers need the REST layer:
- the modeler server, which deploys, runs and tests models in development;
- a production Spring Boot app that embeds the API, for example behind an operations UI.

The two have different safety needs:
- **Arbitrary BPMN is code.** Deploying it allows shell tasks, `activiti:class`, and JUEL that calls beans, so it amounts to remote code execution.
- **Identity in the body is impersonation.** A `user` field in a request body lets a caller act as anyone.
- **Some endpoints are dev tools only:** validate, scenario run, workspace files and trial deployments.

A production host also needs:
- the host's own security (sessions, OAuth2, or Basic);
- a configurable base path;
- role mapping, because Activiti's admin runtimes require `ACTIVITI_ADMIN` or `APPLICATION_MANAGER`;
- DMN viewing alongside BPMN.

## Decision

- **`activiti-runtime-rest-core`:**
  - Covers read models and instance operations for definitions, instances, history, tasks, messages, signals, jobs, timers and variables.
  - **The acting user is always the authenticated principal.** There is no user field in request bodies.
  - The base path is configurable: `activiti.rest.base-path`, default `/api`.
  - The library contributes **no `SecurityFilterChain`**. It only declares method-level authorities, mapped through properties: `activiti.rest.roles.read`, `.operate` and `.admin`. These default to `ROLE_ACTIVITI_USER`, `ROLE_ACTIVITI_USER` and `ROLE_ACTIVITI_ADMIN`.
  - It is the module a production host embeds.
- **`activiti-runtime-rest-dev`:**
  - Covers validate (with a trial deploy into a scratch engine), arbitrary deploy, scenario run, decision evaluate on uploaded DMN, and workspace files.
  - It is only used by `activiti-modeler-server` and the verification harness.
  - It must be enabled explicitly with `activiti.rest.dev.enabled=true`, and it logs a startup warning when on.
  - It may act as a user named in the request, because scenarios need that, but only in dev mode.
- **`activiti-modeler-server`:**
  - Binds to `127.0.0.1` by default.
  - Ships its own dev `SecurityFilterChain`: HTTP Basic with demo users.
  - **Shell tasks** are rejected at deployment unless `modeler.server.allow-shell-tasks=true`. A custom validator enforces this.
- **`runtime-client` (TypeScript):** has pluggable auth, either Basic, a bearer token, or a same-origin cookie with CSRF header, and a configurable base URL and path.
- **`activiti-diagram-viewer`:** wraps both the bpmn-js `NavigatedViewer` and the dmn-js `Viewer`, so a host page can show DMN tables next to the BPMN.

## Consequences

- A production host depends only on `runtime-rest-core`, so the dev endpoints never ship to production by accident.
- Thread-local identity (`Authentication.setAuthenticatedUserId`) is set and cleared per request by a filter in core, so `activiti:initiator` works for API starts.
