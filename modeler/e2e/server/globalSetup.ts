import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, openSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeRuleCheck, writeRunDemo, writeShellProject, writeWarningProject } from './projects';

/**
 * Starts the real modeler server for the server e2e tests (R1-R6, U16):
 *
 *  1. builds the jar once: `scripts/build-server.sh` (the app, then Maven with the app inside; it runs `npm ci` only when node_modules is
 *     missing, so the frozen lockfile is not touched). `MODELER_SERVER_JAR=<jar>` uses a jar that is there; `MODELER_SERVER_REUSE=1`
 *     reuses the jar of the last build without building;
 *  2. picks a free port and a temporary workspace folder, fills it with the e2e projects and copies a few corpus seeds into it;
 *  3. runs `java -jar` with `--server.port`, `--workspace`, a free mail port, and `--no-open --no-window` (no browser, no status window),
 *     `MODELER_HOME` set to a temporary folder (the logs stay out of the real `~/ActivitiModeler`), and waits for `/api/health`.
 *
 * The URL, the workspace and the password-free demo credentials reach the tests through environment variables. The returned function stops
 * the server and removes the workspace.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function jarOf(): string | undefined {
  const target = join(repoRoot, 'java', 'activiti-modeler-server', 'target');
  if (!existsSync(target)) return undefined;
  return readdirSync(target)
    .filter((f) => /^activiti-modeler-server-.*-exec\.jar$/.test(f))
    .map((f) => join(target, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function javaOf(): string {
  const local = join(repoRoot, '.tools', 'jdk-25', 'bin', 'java');
  if (existsSync(local)) return local;
  if (process.env['JAVA_HOME']) return join(process.env['JAVA_HOME'], 'bin', 'java');
  return 'java';
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(url: string, server: ChildProcess, log: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the modeler server stopped (exit ${server.exitCode}); see ${log}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the modeler server did not answer ${url}/api/health within 180 s; see ${log}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  let jar = process.env['MODELER_SERVER_JAR'];
  if (!jar && process.env['MODELER_SERVER_REUSE'] === '1') jar = jarOf();
  if (!jar) {
    const build = spawnSync('bash', [join(repoRoot, 'scripts', 'build-server.sh')], { cwd: repoRoot, stdio: 'inherit', env: process.env });
    if (build.status !== 0) throw new Error('scripts/build-server.sh failed: the server jar could not be built');
    jar = jarOf();
  }
  if (!jar || !existsSync(jar)) throw new Error('no modeler server jar: run scripts/build-server.sh or set MODELER_SERVER_JAR');

  const workspace = mkdtempSync(join(tmpdir(), 'modeler-e2e-workspace-'));
  writeRunDemo(workspace, 'run-demo');
  writeRuleCheck(workspace, 'rule-check');
  writeShellProject(workspace, 'shell-task');
  writeWarningProject(workspace, 'warn-only');
  // hand-written corpus seeds, as they are in the repository: the project layout of ADR 0003 with their scenarios
  for (const id of ['C12-misc-flow', 'C16-dmn-hit-policies']) {
    cpSync(join(repoRoot, 'corpus', id, 'seed'), join(workspace, id), { recursive: true });
    cpSync(join(repoRoot, 'corpus', id, 'scenarios'), join(workspace, id, 'scenarios'), { recursive: true });
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const log = join(tmpdir(), `modeler-e2e-server-${port}.log`);
  const out = openSync(log, 'w');
  const modelerHome = mkdtempSync(join(tmpdir(), 'modeler-e2e-home-'));
  const server = spawn(javaOf(), ['-jar', jar, `--server.port=${port}`, `--workspace=${workspace}`, '--modeler.server.mail.port=0', '--no-open', '--no-window'], {
    stdio: ['ignore', out, out],
    cwd: workspace,
    env: { ...process.env, MODELER_HOME: modelerHome },
  });
  try {
    await waitForHealth(url, server, log);
  } catch (error) {
    server.kill('SIGKILL');
    rmSync(workspace, { recursive: true, force: true });
    rmSync(modelerHome, { recursive: true, force: true });
    throw error;
  }
  process.env['MODELER_SERVER_URL'] = url;
  process.env['MODELER_E2E_WORKSPACE'] = workspace;
  console.log(`modeler server for the e2e tests: ${url} (jar ${jar}, workspace ${workspace})`);

  return async () => {
    server.kill('SIGTERM');
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        server.kill('SIGKILL');
        done();
      }, 15_000);
      server.once('exit', () => {
        clearTimeout(timer);
        done();
      });
    });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(modelerHome, { recursive: true, force: true });
  };
}
