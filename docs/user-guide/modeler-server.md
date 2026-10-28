# Modeler server

`activiti-modeler-server` is one executable jar: the modeler web app, the [runtime REST API](../api/runtime-rest.md) (core and dev) and an embedded Activiti 9.0.0 engine on H2. The modeler uses it to **validate** a project against the real engine, **deploy** and **run** it, **evaluate decisions**, run **scenarios**, and to keep project folders on disk (the "server workspace"). It is a development tool for one machine, not a production server: it deploys and runs arbitrary models, which is remote code execution by design ([ADR 0007](../adr/0007-runtime-rest-split-and-security.md)).

## Start

The easiest way is a download that needs no setup: see the [install guide](install.md) (desktop bundle, jar, Docker). From source:

```bash
./build.sh     # one command: fetches JDK 25 if needed, builds the web app and the jar (Windows: build.cmd)
./run.sh       # starts it (Windows: run.cmd)
```

`./build.sh` needs git and a shell, nothing else: the Maven wrapper (`java/mvnw`) downloads Maven, and Maven's frontend plugin downloads Node 22 into `.tools/node` and builds the web app (`npm ci`, `npm run build` in `modeler/`) with the profile `bundle-modeler`, which copies the app into the jar as `classpath:/static`. Without the profile the jar holds a placeholder page and everything else works. `scripts/build-server.sh` is the older two-step path, kept for the test suites (it builds the app with the Node you have and runs Maven with `-Dmodeler.skipFrontend=true`): `--ci` always run `npm ci`, `--skip-modeler` use the `dist` that is there, `--with-tests` run the Java tests too. `scripts/smoke-server.sh` starts the built jar on a free port and checks it with curl (health, engine report, authentication, the app, a workspace round trip, a validate and a decision call, the loopback binding).

### Start without arguments

`java -jar activiti-modeler-server.jar` (and a double click on the desktop bundle) needs no option. It does this, so that a first start is usable:

| What | Default | Change it with |
|---|---|---|
| Workspace | `~/ActivitiModeler/workspace`, created on first start | `--workspace=<folder>` |
| Port | 8080; when 8080 is taken, a free port. The address actually used is printed (and shown in the window) | `--port=<n>` (then no fallback: a taken port is an error) |
| Browser | opens when a display exists | `--no-open` (`--open` forces it) |
| Status window | a small window when a display exists: the address, the sign-in `modeler` / `modeler`, the project and log folders, **Open in browser** and **Quit**. Closing the window stops the server. While the engine starts it says so; when the server cannot start it shows why | `--no-window` |
| Logs | the console and `~/ActivitiModeler/logs/activiti-modeler.log` (10 MB files, 7 days, 100 MB at most) | `--logging.file.name=<file>` |

All of it lives under one folder, `~/ActivitiModeler` (`%USERPROFILE%\ActivitiModeler` on Windows). Move it with the variable `MODELER_HOME` or `-Dmodeler.home=<folder>`. Every default also yields to an environment variable (`MODELER_WORKSPACE_DIR`, `SERVER_PORT`, `MODELER_SERVER_OPEN_BROWSER=false`, `MODELER_SERVER_STATUS_WINDOW=false`) or a Spring property. Headless machines (no display, such as a server or CI) get neither browser nor window. The defaults are applied by `main` only: the tests start the application through Spring and never open a browser or a window or touch your home folder (surefire sets `-Dmodeler.home` to `target/`).

### Arguments

| Argument | Meaning |
|---|---|
| `--workspace=<folder>` | Project folders the modeler can open and save through the server (`modeler.workspace.dir`). Default `~/ActivitiModeler/workspace` |
| `--port=<n>` | Port (default 8080 or a free one; `0` picks a free one) |
| `--open` / `--no-open` | Open the modeler in the default browser once the server is up (default: when a display exists) |
| `--no-window` | No status window |
| `--help` | Usage |
| `--any.spring.property=value` | Every Spring Boot property can be set the usual way |

The server prints its URL, the demo users, the workspace, the log file, whether shell tasks are allowed and where the mail server listens:

```
  Activiti modeler server is running at http://127.0.0.1:8080/
```

### In a container

The Docker image runs the profile `container` (`application-container.properties`): it listens on `0.0.0.0:8080` inside the container, keeps the projects in the volume `/data`, opens no browser, and **replaces the demo passwords**: every user gets `MODELER_PASSWORD`, or a random password that is printed once in the container's output when `MODELER_PASSWORD` is not set. Publish the port on the host's loopback address only: `docker run -p 127.0.0.1:8080:8080 -v activiti-modeler-data:/data ghcr.io/kleash/activiti-modeler`. See the [install guide](install.md#3-docker).

## Security model

- **It listens on `127.0.0.1` only** (`server.address`). Nobody else on the network can reach it. Setting `server.address=0.0.0.0` exposes remote code execution to the network: do not, unless you also replace the security below.
- **HTTP Basic with demo users.** The server has its own `SecurityFilterChain` (stateless, no CSRF because it never uses cookies). `/api/health` and the app's static files are public; everything under `/api` and `/v3/api-docs` needs a user.

  | User | Password | Authorities | Can |
  |---|---|---|---|
  | `modeler` | `modeler` | `ROLE_ACTIVITI_USER`, `ROLE_ACTIVITI_ADMIN`, groups modelers, clerks, reviewers, managers | everything, including the dev endpoints |
  | `alice` | `alice` | `ROLE_ACTIVITI_USER`, groups clerks, reviewers | the core API and her tasks; the dev endpoints answer 403 |
  | `bob` | `bob` | `ROLE_ACTIVITI_USER`, group managers | the same, other group |

  Define your own with `modeler.server.users.<name>.password` (plain text, or `{bcrypt}...`) and `modeler.server.users.<name>.authorities` (comma separated; `GROUP_<g>` puts the user into the candidate group `g`). The users are the actors of tasks: complete a task as `alice` with `-u alice:alice`. The dev endpoints need `ROLE_ACTIVITI_ADMIN` (they are the admin level of the REST API).
- **CORS** is on for the app served by `vite dev` and `vite preview`: `modeler.server.cors.allowed-origins=http://localhost:5173,http://localhost:4173` (empty switches it off). The bundled app is served by the server itself, same origin, and needs none. A cross-origin request from another origin gets 403.
- **Shell tasks are refused.** A service task of type `shell` runs a command on this machine, so a model that has one is an **error** at validate, deploy, scenario run and any other way a model reaches the engine (the rule is part of the engine's process validation). Start with `--modeler.server.allow-shell-tasks=true` to allow them.
- **The workspace** is a folder you name; paths are checked (no `..`, no links out of the folder, only project file types, size limit). See the [REST reference](../api/runtime-rest.md#workspace-safety).

## What runs inside

| Part | Detail |
|---|---|
| Engine | Embedded Activiti 9.0.0, H2 in memory (data is gone when the server stops; for a file database set `spring.datasource.url=jdbc:h2:file:./modeler-data/engine`). The mandatory settings are on: history `full` with database history, `deployment-mode=default`, suffixes `**.bpmn20.xml,**.bpmn,**.dmn`. **The async executor is on**, so timers and asynchronous tasks run by themselves; the scenario runner drives it in `EXECUTOR` mode |
| REST | Core API under `/api`, dev API under `/api/dev` ([reference](../api/runtime-rest.md)), `GET /api/health`, OpenAPI at `/v3/api-docs` (needs a user). The full description is [`docs/api/openapi-server.json`](../api/openapi-server.json) |
| Modeler app | The modeler web app from `classpath:/static` (any address without a file extension that is not under the API gets `index.html`). Every response carries the header `X-Activiti-Modeler-Server: 1`: the app asks for its own page and looks for it before it asks for `/api/health`, so a modeler served by something else (a static file server) makes no request to a server that is not there |
| DMN | `activiti-dmn-connector` (Operaton), so decision tasks and `POST /api/dev/decisions/evaluate` work |
| Connectors | The recording wrapper of the scenario runner around every `Connector` bean (what `expectConnectorCall` in a scenario reads), and three sample connectors: `echo.EXECUTE` (returns its inputs and `echoCount`), `http.GET` (a **mock**: it never touches the network; inputs `url`, optional `status`; outputs `statusCode`, `body`, `headers`) and `crm.LOOKUP` (input `customerId`; outputs `customerName`, `tier` (`gold` for ids that start with `G-`), `found`). Your own connector is a Spring bean named `<name>.<ACTION>` on the class path |
| Mail | An embedded SMTP server (GreenMail) on `127.0.0.1` with no authentication; the engine's mail settings point at it, so a mail task runs and its message appears at `GET /api/dev/mail` (and is deleted with `DELETE /api/dev/mail`). Configure with `modeler.server.mail.enabled`, `.port` (0: free port, shown at startup) and `.default-from`; with `enabled=false` use `spring.activiti.mail-server-*` |

## Properties

| Property | Default | Meaning |
|---|---|---|
| `server.address` / `server.port` | `127.0.0.1` / 8080 or a free port | Binding |
| `modeler.workspace.dir` | `~/ActivitiModeler/workspace` (set by `main`; none under Spring alone) | Workspace folder (`--workspace`) |
| `modeler.server.open-browser`, `modeler.server.status-window` | on when a display exists (set by `main`) | Browser and status window |
| `MODELER_HOME` / `-Dmodeler.home` | `~/ActivitiModeler` | The folder of the default workspace and logs |
| `modeler.workspace.allowed-suffixes`, `.max-file-size` | project file types, 10 MB | Workspace limits |
| `modeler.server.allow-shell-tasks` | `false` | Allow shell tasks |
| `modeler.server.users.*` | `modeler`, `alice`, `bob` | Demo users |
| `modeler.server.cors.allowed-origins` | `http://localhost:5173,http://localhost:4173` | CORS origins |
| `modeler.server.mail.*` | enabled, free port | Embedded SMTP |
| `activiti.rest.base-path` | `/api` | Base path of the API |
| `activiti.rest.roles.read`, `.operate`, `.admin` | `ROLE_ACTIVITI_USER`, `ROLE_ACTIVITI_USER`, `ROLE_ACTIVITI_ADMIN` | Authorities of the access levels |
| `activiti.rest.dev.enabled` | `true` here, `false` in the library | The dev endpoints |
| `activiti.rest.dev.scenario-lock-timeout` | `30s` | How long a scenario run waits for another one |
| `activiti.scenario.executor-timeout` | `10s` | How long `executeJobs` waits for the async executor |

## Using the API from the command line

```bash
curl -u modeler:modeler http://127.0.0.1:8080/api/engine
curl -u modeler:modeler -H 'Content-Type: application/json' \
     -d '{"files":[{"path":"processes/order.bpmn20.xml","content":"..."}]}' http://127.0.0.1:8080/api/dev/validate
```

More in [the REST reference](../api/runtime-rest.md#using-the-api); from TypeScript use `@activiti-modeler/runtime-client`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| The browser asks for a user name and password | The API needs a login. Use `modeler` / `modeler`. The modeler app signs in itself: **Run > Connect to server...** takes the URL, user and password ([Running and testing from the modeler](running.md#connect-to-a-server)) |
| A model with a shell task is "not allowed" | Shell tasks are off, see above |
| 403 on `/api/dev/...` | The user lacks `ROLE_ACTIVITI_ADMIN` (use `modeler`) |
| 404 on `/api/dev/workspace` | The server was started without `--workspace` |
| `Address already in use` | You gave a port (`--port=`, `SERVER_PORT`) and another program uses it. Without a port the server falls back to a free one |
| The browser did not open | Nothing opens without a display (headless), with `--no-open`, or when the system has no default browser: use the address printed by the server, or **Open in browser** in the status window |
| Where are my projects / the logs? | `~/ActivitiModeler/workspace` and `~/ActivitiModeler/logs` (or the folder `MODELER_HOME` names); the status window shows both |
| Scenario run answers 409 | Another scenario run is in progress; runs are one at a time (the engine clock is shared) |
| `vite dev` cannot call the server | The origin is not in `modeler.server.cors.allowed-origins` |
| The page says "The modeler web app is not bundled" | The jar was built without `-Pbundle-modeler`; run `./build.sh` |
