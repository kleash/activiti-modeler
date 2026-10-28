/**
 * The run side of the modeler (features R1-R6): what the person is doing with the connected modeler server. One service for the page,
 * like the lint service and the connection; React reads it through `useRun`.
 *
 * - **Deploy (R2)**: save the open editors, run the deploy gate of the lint (`checkDeployable`: errors block, warnings need a
 *   confirmation), send the project to `POST /api/dev/deployments`, show what the engine made of it.
 * - **Navigation**: the workbench (Deploy, Start, Instances, Scenarios), the instance that is selected, a process the Start form
 *   should open with.
 */
import { classifyFile, type ProjectWorkspace } from '@activiti-modeler/activiti-project';
import { runtimeClientValidator, type Problem } from '@activiti-modeler/bpmnlint-plugin-activiti';
import { RuntimeApiError, type DeployResponse, type FileEntry, type Problem as EngineProblem } from '@activiti-modeler/runtime-client';

import { lintService } from '../lint/LintService';
import { connection, type ConnectionService } from './connection';
import { scenarioResults, type ScenarioRunRecord } from './scenarioStore';

export type WorkbenchTab = 'deploy' | 'start' | 'instances' | 'scenarios';

/** What the run service needs of the app shell. */
export interface RunHost {
  workspace(): ProjectWorkspace | undefined;
  /** Saves every open editor and working copy; false when one failed. */
  saveAll(): Promise<boolean>;
  toast(message: string, kind?: 'info' | 'success' | 'error', detail?: string): void;
  askChoice(options: { title: string; message: string; detail?: string; choices: Array<{ id: string; label: string; primary?: boolean; danger?: boolean }> }): Promise<string | undefined>;
  /** Opens a file of the project in a tab. */
  openFile(path: string): void;
  /** Opens the scenario files' editor and the bottom panel on demand. */
  showBottomPanel(): void;
}

export interface DeploymentView extends DeployResponse {
  /** When the deployment was made (ms since epoch). */
  at: number;
  project: string;
}

export type DeployOutcome =
  | { kind: 'deployed'; deployment: DeploymentView }
  /** The lint or the server's validation found errors; nothing was sent. */
  | { kind: 'blocked'; problems: Problem[]; counts: { error: number; warning: number; info: number } }
  | { kind: 'cancelled'; reason: 'warnings' | 'save' | 'not-connected' | 'empty' }
  /** The server refused the project (422) after the gate passed. */
  | { kind: 'refused'; message: string; problems: EngineProblem[] }
  | { kind: 'failed'; message: string };

export interface RunSnapshot {
  open: boolean;
  tab: WorkbenchTab;
  connectionDialog: boolean;
  deploying: boolean;
  deployment?: DeploymentView;
  /** The result of the last deploy attempt that did not deploy. */
  lastOutcome?: Exclude<DeployOutcome, { kind: 'deployed' }>;
  /** The Start form opens on this process key (set by "Start" next to a deployed definition). */
  startKey?: string;
  selectedInstanceId?: string;
  /** A scenario file the Scenarios tab should run or show. */
  scenarioPath?: string;
  revision: number;
}

/** Files of the project the engine deploys, as the dev endpoints take them (paths as in the project, ADR 0003). */
export function deployableFiles(workspace: ProjectWorkspace): FileEntry[] {
  return workspace.model
    .paths()
    .filter((path) => ['bpmn', 'dmn', 'extensions'].includes(classifyFile(path)))
    .sort()
    .map((path) => ({ path, content: workspace.model.read(path) ?? '' }));
}

/** The text of the error a failed request carries: the server's `detail`, else its message. */
export function errorMessage(error: unknown): string {
  if (error instanceof RuntimeApiError) {
    const detail = error.problem?.detail ?? error.problem?.title;
    return detail ? `${detail} (${error.status})` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export class RunService {
  private host?: RunHost;
  private readonly listeners = new Set<() => void>();
  private snapshotState: Omit<RunSnapshot, 'revision'> = { open: false, tab: 'deploy', connectionDialog: false, deploying: false };
  private revision = 0;
  private snap: RunSnapshot = { ...this.snapshotState, revision: 0 };
  private lastStatus: string | undefined;

  constructor(private readonly conn: ConnectionService = connection) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RunSnapshot => this.snap;

  private set(patch: Partial<Omit<RunSnapshot, 'revision'>>): void {
    this.snapshotState = { ...this.snapshotState, ...patch };
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      if (patch[key] === undefined) delete (this.snapshotState as Record<string, unknown>)[key];
    }
    this.revision += 1;
    this.snap = { ...this.snapshotState, revision: this.revision };
    for (const listener of [...this.listeners]) listener();
  }

  /** Wires the service to the shell and to the lint: a connected server validates the project (source `engine` in the Problems panel). */
  bind(host: RunHost): void {
    this.host = host;
    if (this.lastStatus === undefined) {
      this.conn.subscribe(() => this.onConnectionChange());
      this.onConnectionChange();
    }
  }

  private onConnectionChange(): void {
    const status = this.conn.getSnapshot().status;
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    if (status === 'connected') lintService.setServerValidator(runtimeClientValidator(this.conn.require()));
    else lintService.setServerValidator(undefined);
  }

  // --- navigation -----------------------------------------------------------------------------------------------------------------

  openWorkbench(tab?: WorkbenchTab): void {
    this.set({ open: true, ...(tab ? { tab } : {}) });
  }

  closeWorkbench(): void {
    this.set({ open: false });
  }

  setTab(tab: WorkbenchTab): void {
    this.set({ tab });
  }

  openConnectionDialog(): void {
    this.set({ connectionDialog: true });
  }

  closeConnectionDialog(): void {
    this.set({ connectionDialog: false });
  }

  /** The Start form for a process (after a deploy, or from the menu). */
  startForm(processKey?: string): void {
    this.set({ open: true, tab: 'start', startKey: processKey });
  }

  /** Shows an instance in the Instances tab. */
  showInstance(id: string | undefined): void {
    this.set({ open: true, tab: 'instances', selectedInstanceId: id });
  }

  /** Opens the Scenarios tab on a scenario file of the project. */
  showScenario(path: string | undefined): void {
    this.set({ open: true, tab: 'scenarios', scenarioPath: path });
  }

  // --- deploy (R2) ------------------------------------------------------------------------------------------------------------------

  /**
   * Deploys the project. The gate is the lint's `checkDeployable` (errors of the open diagrams and of the engine's own validation
   * block; warnings need a confirmation). The server validates the files it is sent, which are the saved working copies, so every open
   * editor is saved first.
   */
  async deploy(): Promise<DeployOutcome> {
    const host = this.host;
    if (!host) return { kind: 'failed', message: 'the run service is not bound to the app' };
    const workspace = host.workspace();
    if (!workspace) return { kind: 'failed', message: 'no project is open' };
    if (!this.conn.connected) {
      this.openConnectionDialog();
      host.toast('Connect to a modeler server first', 'info');
      return this.remember({ kind: 'cancelled', reason: 'not-connected' });
    }
    this.set({ deploying: true });
    try {
      if (!(await host.saveAll())) {
        host.toast('The project was not deployed: saving failed', 'error');
        return this.remember({ kind: 'cancelled', reason: 'save' });
      }
      const files = deployableFiles(workspace);
      if (!files.some((f) => classifyFile(f.path) === 'bpmn' || classifyFile(f.path) === 'dmn')) {
        host.toast('The project has no process or decision to deploy', 'error');
        return this.remember({ kind: 'cancelled', reason: 'empty' });
      }
      const gate = await lintService.checkDeployable();
      if (!gate.deployable) {
        host.showBottomPanel();
        host.toast(`Not deployed: ${gate.counts.error} error${gate.counts.error === 1 ? '' : 's'} in the project (see Problems)`, 'error');
        return this.remember({ kind: 'blocked', problems: gate.problems.filter((p) => p.severity === 'error'), counts: gate.counts });
      }
      if (gate.counts.warning > 0) {
        const answer = await host.askChoice({
          title: 'Deploy with warnings?',
          message: `The project has ${gate.counts.warning} warning${gate.counts.warning === 1 ? '' : 's'} and no errors.`,
          detail: gate.problems
            .filter((p) => p.severity === 'warning')
            .slice(0, 8)
            .map((p) => `${p.path}${p.elementId ? ` (${p.elementId})` : ''}: ${p.message}`)
            .join('\n'),
          choices: [
            { id: 'deploy', label: 'Deploy anyway', primary: true },
            { id: 'problems', label: 'Show the problems' },
            { id: 'cancel', label: 'Cancel' },
          ],
        });
        if (answer !== 'deploy') {
          if (answer === 'problems') host.showBottomPanel();
          return this.remember({ kind: 'cancelled', reason: 'warnings' });
        }
      }
      const client = this.conn.require();
      let result: DeployResponse;
      try {
        result = await client.devDeploy(files, `modeler-${workspace.name}`);
      } catch (error) {
        if (error instanceof RuntimeApiError && error.status === 422) {
          const problems = (error.problem as { problems?: EngineProblem[] } | undefined)?.problems ?? [];
          lintService.setServerProblems(problems);
          host.showBottomPanel();
          host.toast('The server refused the project (see Problems)', 'error', errorMessage(error));
          return this.remember({ kind: 'refused', message: errorMessage(error), problems });
        }
        throw error;
      }
      const deployment: DeploymentView = { ...result, at: Date.now(), project: workspace.name };
      this.set({ deployment, open: true, tab: 'deploy', lastOutcome: undefined });
      host.toast(`Deployed ${result.definitions.length} process definition${result.definitions.length === 1 ? '' : 's'}${result.decisions.length ? ` and ${result.decisions.reduce((n, d) => n + d.decisions.length, 0)} decision(s)` : ''}`, 'success');
      return { kind: 'deployed', deployment };
    } catch (error) {
      const message = errorMessage(error);
      host.toast(`The deployment failed: ${message}`, 'error');
      return this.remember({ kind: 'failed', message });
    } finally {
      this.set({ deploying: false });
    }
  }

  // --- scenarios (R6) -----------------------------------------------------------------------------------------------------------

  /**
   * Saves the project and runs a scenario file on the server. `text` is the content in the scenario editor (not yet in the working
   * copy); without it the working copy is used. Resolves with the record, or undefined when nothing was run.
   */
  async runScenario(path: string, text?: string): Promise<ScenarioRunRecord | undefined> {
    const host = this.host;
    const workspace = host?.workspace();
    if (!host || !workspace) return undefined;
    if (!this.conn.connected) {
      this.openConnectionDialog();
      host.toast('Connect to a modeler server to run a scenario', 'info');
      return undefined;
    }
    if (!(await host.saveAll())) {
      host.toast('The scenario was not run: saving failed', 'error');
      return undefined;
    }
    return scenarioResults.run(workspace, path, text);
  }

  /** Runs every scenario file of the project, one after the other. */
  async runAllScenarios(): Promise<ScenarioRunRecord[]> {
    const workspace = this.host?.workspace();
    if (!workspace) return [];
    const records: ScenarioRunRecord[] = [];
    for (const path of workspace.model.paths().filter((p) => classifyFile(p) === 'scenario').sort()) {
      const record = await this.runScenario(path);
      if (!record) break;
      records.push(record);
    }
    return records;
  }

  private remember<T extends Exclude<DeployOutcome, { kind: 'deployed' }>>(outcome: T): T {
    this.set({ lastOutcome: outcome });
    return outcome;
  }

  get hostBound(): RunHost | undefined {
    return this.host;
  }
}

export const runService = new RunService();
