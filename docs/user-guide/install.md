# Install the Activiti Modeler

Pick the way that suits you; they are listed from the simplest. All of them give the same modeler: the web app, the validation, deployment and test runs on an embedded Activiti 9.0.0, and your projects as folders you can open in git.

| Way | You need | Time to a running modeler |
|---|---|---|
| [1. Desktop app](#1-desktop-app-download-unzip-double-click) | nothing (Java is inside) | a minute |
| [2. Executable jar](#2-executable-jar) | Java 25 | a minute |
| [3. Docker](#3-docker) | Docker | a minute |
| [4. In the browser, nothing to install](#4-in-the-browser-without-a-server) | a browser | seconds (no server: you can model, not run) |
| [5. From source](#5-from-source-one-command) | git, a shell, an internet connection | a few minutes |

Downloads are on the [releases page](https://github.com/kleash/activiti-modeler/releases).

## 1. Desktop app: download, unzip, double-click

Download the file for your computer:

| Your computer | File |
|---|---|
| Windows 10 or 11 | `activiti-modeler-<version>-windows-x64.zip` |
| Mac with Apple silicon (M1 and newer) | `activiti-modeler-<version>-macos-arm64.zip` |
| Mac with an Intel processor | `activiti-modeler-<version>-macos-x64.zip` |
| Linux (x64) | `activiti-modeler-<version>-linux-x64.zip` |

Unzip it anywhere (not inside the zip viewer: extract it) and open **Activiti Modeler**:

- **Windows:** `Activiti Modeler\Activiti Modeler.exe`
- **macOS:** `Activiti Modeler.app`
- **Linux:** `Activiti Modeler/bin/Activiti Modeler` (from a terminal: `"./Activiti Modeler/bin/Activiti Modeler"`)

A small window "Activiti Modeler is running" appears, with the address, the sign-in and two buttons, and your browser opens the modeler. **Open in browser** opens it again; **Quit** (or closing the window) stops the server. The first start takes a few seconds longer than the next ones.

- Your projects are folders in `~/ActivitiModeler/workspace` (Windows: `C:\Users\<you>\ActivitiModeler\workspace`). The modeler's **File** menu opens and saves them; they are plain files, so git works on them.
- The log is in `~/ActivitiModeler/logs/`.
- The server listens on your own machine only (`127.0.0.1`), by default on port 8080, or on a free port when 8080 is taken (the window shows the address). Sign in with `modeler` / `modeler` if the browser asks.
- To remove it, delete the app folder. Your projects stay in `ActivitiModeler`.
- To update, download the new version and replace the app folder; projects are kept.

### The first start: opening an app that is not signed

The apps are not code-signed (signing needs paid developer accounts, see [ADR 0008](../adr/0008-distribution.md)), so macOS and Windows show a warning the first time. The app is safe to open if you downloaded it from the releases page; check the file against `SHA256SUMS` from the same page if you want to be sure (`sha256sum -c SHA256SUMS` on Linux, `shasum -a 256 -c SHA256SUMS` on macOS, `Get-FileHash <file>` on Windows).

**macOS.** The first double-click says the app "can't be opened because Apple cannot check it for malicious software" (or that it is damaged).
1. In Finder, **right-click** (or Control-click) `Activiti Modeler.app` and choose **Open**, then **Open** again in the dialog. You do this once.
2. On macOS 15 (Sequoia) and later the dialog may offer no **Open** button. Then: double-click the app once, open **System Settings > Privacy & Security**, scroll to **Security**, press **Open Anyway** next to "Activiti Modeler", and confirm.
3. If it says the app is "damaged and can't be opened", macOS has marked the download as quarantined. In Terminal, run `xattr -dr com.apple.quarantine "/path/to/Activiti Modeler.app"` (type `xattr -dr com.apple.quarantine ` and drag the app into the window), then open it again.

**Windows.** Windows SmartScreen shows "Windows protected your PC".
1. Click **More info**, then **Run anyway**.
2. If you cannot open the app at all, right-click the downloaded zip before unzipping, choose **Properties**, tick **Unblock** at the bottom, press **OK**, and unzip again.
3. If the Windows firewall asks whether to allow `Activiti Modeler`, you can choose **Cancel**: the server only talks to your own browser.

**Linux.** There is no warning. If the launcher is not executable (some unzip tools drop the permission), run `chmod +x "Activiti Modeler/bin/Activiti Modeler" "Activiti Modeler/lib/runtime/bin/java"`. A browser must be installed for the automatic opening; without one, use the address in the window.

## 2. Executable jar

With Java 25 or newer installed (`java -version`):

```bash
java -jar activiti-modeler-<version>.jar
```

It starts exactly like the desktop app (window, browser, `~/ActivitiModeler`). Options: `--workspace=<folder>`, `--port=<n>`, `--no-open`, `--no-window`, `--help`; see [the server guide](modeler-server.md). On a machine without a display (a server) there is no window and no browser; open the printed address from your own machine, which means forwarding the port yourself, since the server only listens on `127.0.0.1`.

## 3. Docker

```bash
docker run --rm -p 127.0.0.1:8080:8080 -v activiti-modeler-data:/data ghcr.io/kleash/activiti-modeler
```

Open <http://localhost:8080> and sign in as `modeler` with the password the container prints in its output (`Sign in as modeler with the password ...`). To choose it yourself add `-e MODELER_PASSWORD=<your password>`. The projects are in the volume `/data` (`-v ./my-projects:/data` uses a folder; it must be writable by user id 65532). The image is built `FROM scratch` (the Java runtime and the musl C library; no shell, no package manager), runs as the unprivileged user id 65532 and supports `linux/amd64` and `linux/arm64`. For a tighter container add `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`.

**Publish the port on `127.0.0.1` as shown.** Inside the container the server must listen on all addresses, and it runs models, which is remote code execution by design: `-p 8080:8080` would offer it to your whole network. The demo passwords (`modeler`/`modeler`, `alice`/`alice`, `bob`/`bob`) do not work in the container; every user gets the one password above.

Use a version tag (`ghcr.io/kleash/activiti-modeler:<version>`) to stay on a release; `latest` follows the newest non-preview release.

## 4. In the browser, without a server

Open <https://kleash.github.io/activiti-modeler/>. Nothing is installed and nothing is sent anywhere: the page is static, and your projects are stored in this browser (IndexedDB), next to the site's data. You can model BPMN and DMN, lint, import Camunda 7 models and export. **Running** a model (validate on the engine, deploy, start, scenarios, decision tests) needs a modeler server: the Run menu says "Not connected to a modeler server"; start one with way 1, 2 or 3 and use **Run > Connect to server...**. The server only accepts calls from its own pages by default (CORS); to use it from this site, start it with `--modeler.server.cors.allowed-origins=https://kleash.github.io`, and note that browsers may still restrict a page on `https://` from calling a server on your machine. The desktop app serves its own copy of the modeler, which avoids all of that.

Clearing the site data of your browser deletes the projects stored in it: export or use a server workspace for anything you want to keep.

## 5. From source: one command

You need git, a shell and an internet connection; no Maven, no Node and no particular Java.

```bash
git clone https://github.com/kleash/activiti-modeler.git
cd activiti-modeler
./build.sh        # Windows: build.cmd
./run.sh          # Windows: run.cmd
```

`build.sh` downloads Temurin JDK 25 into `.tools/jdk-25` if `java` on your path is older, then runs the Maven wrapper, which downloads Maven; the build downloads Node 22 into `.tools/node` and builds the web app. The result is `java/activiti-modeler-server/target/activiti-modeler-server-<version>-exec.jar`, which `run.sh` starts (extra arguments go to the server: `./run.sh --workspace=my-projects --no-open`). The first build downloads about 500 MB (the libraries, Maven, Node, the JDK) and takes a few minutes; later builds take a minute. `./build.sh --with-tests` also runs the Java tests. To build the desktop app for your own machine afterwards: `scripts/package-desktop.sh` (Windows: `scripts\package-desktop.ps1`).

## Checking what you downloaded

Every release has a `SHA256SUMS` file. Put it next to the downloads and run `sha256sum -c SHA256SUMS --ignore-missing` (Linux), `shasum -a 256 -c SHA256SUMS --ignore-missing` (macOS), or compare `Get-FileHash <file>` with the line in the file (Windows). Every download contains `LICENSE` (Apache License 2.0), `NOTICE` and `THIRD-PARTY-NOTICES.md` (the licences of the bundled libraries, including the bpmn.io watermark condition and the bundled Eclipse Temurin runtime).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| macOS: "cannot be opened because the developer cannot be verified", or "is damaged" | The app is not signed: see [the first start](#the-first-start-opening-an-app-that-is-not-signed) |
| Windows: "Windows protected your PC" | SmartScreen: **More info**, **Run anyway** |
| Nothing seems to happen for a few seconds | The engine is starting (a window "starting..." shows when a display exists). On a slow machine up to a minute. The log is `~/ActivitiModeler/logs/activiti-modeler.log` |
| A window says "Activiti Modeler could not start" | It says why, and the log has the details. Typical causes: the folder `~/ActivitiModeler` is not writable (set `MODELER_HOME` to another folder), or a Spring property was given a bad value |
| The browser did not open | Use **Open in browser** in the window, or the address it shows (`http://127.0.0.1:8080/` or another port when 8080 was taken) |
| The browser asks for a user name and password | `modeler` / `modeler` (Docker: the password in the container output) |
| "Address already in use" | You gave `--port` and another program uses it. Without `--port` the server picks a free port by itself |
| `UnsupportedClassVersionError` running the jar | Java older than 25. Use the desktop app (it brings Java), Docker, or install JDK 25 (`./build.sh` does it for you) |
| `./build.sh`: "Could not download" or certificate errors | The build needs `https://api.adoptium.net`, `repo.maven.apache.org`, `artifacts.alfresco.com`, `nodejs.org` and `registry.npmjs.org`. Behind a company proxy, set the proxy for Maven (`~/.m2/settings.xml`) and npm; with a custom certificate authority give Java and Node the certificate (`JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStore=...`, `NODE_EXTRA_CA_CERTS=...`) |
| Docker: `permission denied` writing to `/data` | A mounted folder must be writable by user id 65532: `chown 65532 <folder>`, or use a named volume |
| Docker: connection refused from another machine | By design: publish with `-p 127.0.0.1:8080:8080` and use an SSH tunnel or a reverse proxy with its own authentication if you must reach it remotely |
| The browser-only site keeps no projects after a restart | The browser deletes site data in private windows or when told to; use a normal window, or a server workspace |
| Anything else | The log file, then [an issue](https://github.com/kleash/activiti-modeler/issues) with the log and your operating system |
