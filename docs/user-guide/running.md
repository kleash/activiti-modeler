# Running and testing from the modeler

The modeler can deploy the open project to a running **modeler server** (`activiti-modeler-server`, see [Modeler server](modeler-server.md)), start process instances, work the tasks of an instance, watch an instance on its diagram and run test [scenarios](scenarios.md). Everything is in the **Run** menu and in the run view that opens over the editor area. A diagram can also be tried out without a server with the token simulation.

Contents: [connect](#connect-to-a-server) - [deploy](#deploy) - [start](#start-an-instance) - [instances](#instances) - [the diagram of an instance](#the-diagram-of-an-instance) - [scenarios](#scenarios) - [record a scenario](#record-a-scenario) - [token simulation](#token-simulation) - [what is not covered](#limits)

## Connect to a server

**Run > Connect to server...** (or the server entry at the right of the status bar) opens the connection dialog.

| Field | Meaning |
|---|---|
| Server URL | the base URL of the modeler server, for example `http://localhost:8080`. Empty means the server that served this page. When the page comes from `vite dev` or `vite preview` (ports 5173 and 4173) the default is `http://localhost:8080` |
| User name, password | HTTP Basic credentials; the server's default is `modeler` / `modeler` (set `MODELER_ADMIN_PASSWORD`, see [Modeler server](modeler-server.md)) |
| Remember the password in this browser | off by default. The URL and the user name are kept in the browser's local storage; **the password is not, unless you tick this**. Without it the password lives in memory and you type it again after a reload |

The status bar shows the state: `Server: not connected`, `not signed in`, or `Server: modeler@localhost:8080 - Activiti 9.0.0 - DMN operaton - executor on` (the user, the engine version, the DMN engine and whether the async executor is running). The health of the server is polled every ten seconds while connected. A page served by the modeler server itself (the server marks its responses with the header `X-Activiti-Modeler-Server`, which the page looks for), or a browser that was connected before, looks for the server when it loads; any other page waits until you open the dialog, so a modeler without a server shows no network errors.

A wrong password is reported by the server as 401 and shown in the dialog; "No answer from the server" means nothing listens at that URL (or the browser was refused by CORS: the server allows the origins of `modeler.server.cors-origins`).

All run actions act as the connected user. Tasks you complete are completed by that user, in a scenario the users of the scenario file act.

## Deploy

**Run > Deploy project** (the run view's **Deploy** tab has the button too) does this, in order:

1. saves every open file;
2. **lint gate**: lints the project; any error stops the deployment and the Problems panel shows it. Warnings ask first (**Deploy anyway**, **Show the problems**, **Cancel**);
3. asks the server to validate the project (`POST /api/dev/validate`: a trial deployment in a scratch engine). The engine's problems are mapped to the elements they belong to and appear in the Problems panel with the source **engine**; they stop the deployment too;
4. deploys (`POST /api/dev/deployments`) the processes, DMN files and `-extensions.json` files of the project as one deployment named `modeler-<project>`.

The result lists the process definitions (key, version), the decisions and the resources of the deployment. The server holds the working copy of the project in its workspace; for validation it reads the files you are editing, which is why the modeler saves first.

Every deployment creates new versions of the process definitions. Call activities resolve the latest version of the called key across all deployments.

## Start an instance

**Run > Start instance...** opens the Start tab:

- pick the process (the deployed definitions of the project);
- optionally a **business key**;
- the **variables**, typed. The list starts from the process's variables in the extensions file (name, type, default); you edit the values, add or remove variables, and each value is checked against its type before it is sent (an integer must be an integer, a date an ISO 8601 instant, a JSON variable valid JSON);
- or **start by message**: give the message name (and the business key); the server starts the instance whose message start event listens for it.

The instance opens in the Instances tab.

## Instances

The Instances tab lists the process instances of the server (filter: all, active, completed; and by process key). A list entry shows the process, business key, state and start time. The list refreshes by polling (every one and a half seconds while the tab is open), so what an async executor or another client does shows up on its own.

The detail view of an instance has, next to the diagram, these panels:

| Panel | What you can do |
|---|---|
| **Tasks** | claim, release, assign to a user, and **complete** a task with variables, as the connected user. Completion variables are local to the task; they reach the process only through the task's output mapping |
| **Variables** | list the instance variables with their types, edit a value, add a variable |
| **Jobs** | timer jobs, executable jobs and dead letters: **Fire now** moves a timer to the executable table, **Execute** runs a job, **Retry** moves a dead letter back. A dead letter shows its exception message and has a stack trace button |
| **Events** | message and signal subscriptions: **Send message** (name, correlation key, variables), **Send signal**, and a button to trigger a receive task that waits |
| **Path** | the activities that ran, in order, with start and end time. Activities the history does not record are marked as inferred (see below) |

## The diagram of an instance

The diagram next to the panels is read-only (pan and zoom only) and is coloured from the instance; a legend sits under it:

- **active** activities have a thick blue outline, with a badge when several tokens wait there;
- **completed** activities have a green outline;
- the **sequence flows taken** are green;
- an activity with a dead-letter job (a **failed job**) has a red outline and a badge with the number of failed jobs; a banner above the diagram counts them.

Clicking an element selects it: its task card is highlighted in the Tasks panel, and a note above the panels names the selected element. Activiti writes no history entry for an event sub process or for the container a token is waiting in, so the viewer does not read these from the history: it infers them from the activities inside (a container with a completed or active child counts as taken). When the engine recorded no sequence flows at all, the flows are inferred from the model and the activities visited, and the legend and the Path panel say so (`recorded` or `inferred`).

In the **Deploy** tab, **View** on a deployed decision opens its decision table in a read-only DMN viewer. The viewers carry the bpmn.io watermark, as the bpmn.io license requires.

## Scenarios

A scenario file `scenarios/<name>.scenario.json` describes processes to start and the steps and expectations; the format is in [Scenarios](scenarios.md). Open one from the project explorer and the **scenario editor** opens with two views:

- **Form**: users, clock, the scenarios with their start, steps (each step type has its own fields) and expectations (state, end events, path, variables, absent variables, dead letters), and the decision checks;
- **JSON**: the file itself. Both views edit the same file. The JSON is checked against `schemas/scenario.schema.json` as you type; each problem is listed under the editor with its JSON pointer and marked in the JSON where the text is in view.

**Run** in the editor (or **Run > Run all scenarios**) sends the project and the scenario to the server (`POST /api/dev/scenarios/run`). The server deploys the project in a scratch deployment with the async executor on, runs every scenario in isolation, and deletes the deployment afterwards. The step report lists each step as passed or failed with the expected and actual values, and a failed step names the cause. Select a scenario in the report to see its **path** on the diagram: the activities and flows it visited are coloured, those it did not visit are left as they are, so coverage gaps are visible.

Things to know:

- a scenario run uses its own deployment. Starting it deletes that deployment at the end, and with it the message start subscriptions it created; message start events of an earlier deployment with the same message name may be dropped by the engine at that moment. Deploy again after running scenarios if you rely on message start events;
- the async executor is **on** on the modeler server, so asynchronous steps run at once. A scenario that asserts the state *between* an async step and its job (`expectActive` on an async task before `executeJobs`) holds only with the executor off, which is how the verification harness runs the corpus. The modeler server's corpus test lists the corpus scenarios that need the executor off, with the reason for each;
- clocks: `advanceClock` and `fireTimer` act on the engine clock. Timer jobs of the scenario's own instances are made executable at once.

## Record a scenario

Tick **Record this run as a scenario** in the Start tab and start the instance. A banner above the instance says that a scenario is being recorded. What you then do with that instance is kept as steps: claim, release and assign, **complete** (kept as an `expectTask` for the task, then the claim if it was needed, then the `completeTask` with its variables), messages, signals, receive tasks, **Fire now** on a timer, **Execute** on a job and variable edits. Actions on other instances, retrying a dead letter and removing a variable are not recorded.

**Save as scenario...** asks for a name and writes `scenarios/<name>.scenario.json` into the project; the file opens in the scenario editor. The start of the file is what you started (process or message, business key, variables, your user). The users of the file are the people who acted, in the candidate groups of the tasks they worked on. The expectations are read from the final state of the instance: its state (completed, active or dead letter), the end events reached, the activities entered, the final variables and the dead-letter jobs. They record what the engine did in this run; they are not proof that the model is right, so read the file and trim what does not matter before you rely on it. **Discard** drops the recording.

Run the file as any scenario file (a scenario run needs the admin login; the people inside the file act as themselves).

## Token simulation

Next to the diagram's tools there is a **Simulate tokens** toggle (it needs no server). It opens `bpmn-js-token-simulation` on a copy of the diagram: start a token on a start event, step through gateways and watch tokens move; your diagram is not changed.

The simulation is gated by the linter: a diagram with errors for constructs that Activiti does not run (rules such as `activiti/no-unsupported-event-definition`, the hidden constructs of the support matrix) is not simulated, because the simulation would show a behaviour the engine does not have. The toggle then explains why instead of opening. The simulation knows nothing about Activiti semantics beyond BPMN: expressions are not evaluated, delegates, connectors and DMN do not run. For real behaviour deploy and use the instance view or a scenario.

## Limits

- The run view needs the modeler server. The static modeler (browser workspace) can edit and simulate but not deploy.
- Authentication is HTTP Basic only (the server's `modeler.server.admin-password`); the modeler does not manage users.
- The instance view polls; it does not receive server pushes.
- The viewers (instance diagram, DMN viewer, token simulation) are the bpmn.io libraries with their watermark; the license forbids hiding it.
