/**
 * Runs scenario files on the connected server (R6) and keeps the latest result per file, so the scenario editor and the Scenarios tab
 * show the same report. A run deploys the project's files as a deployment of its own on the server's live engine and removes
 * everything afterwards (docs/api/runtime-rest.md, "Scenario run isolation"); runs are one at a time on the server, and here too.
 */
import { classifyFile, type ProjectWorkspace } from '@activiti-modeler/activiti-project';
import { RuntimeApiError, type Problem as EngineProblem, type ScenarioRunResponse } from '@activiti-modeler/runtime-client';

import { connection } from './connection';
import { deployableFiles, errorMessage } from './runService';

export interface ScenarioRunRecord {
  path: string;
  running: boolean;
  /** When the run finished (ms since epoch). */
  at?: number;
  response?: ScenarioRunResponse;
  /** Why there is no report: the file is not JSON, the server refused the project, the server is not reachable. */
  error?: string;
  problems?: EngineProblem[];
}

export interface ScenarioResultsSnapshot {
  records: ReadonlyMap<string, ScenarioRunRecord>;
  /** True while any run is in progress. */
  busy: boolean;
  revision: number;
}

export class ScenarioResults {
  private records = new Map<string, ScenarioRunRecord>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private snap: ScenarioResultsSnapshot = { records: this.records, busy: false, revision: 0 };
  private chain: Promise<unknown> = Promise.resolve();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ScenarioResultsSnapshot => this.snap;

  private set(record: ScenarioRunRecord): void {
    this.records = new Map(this.records).set(record.path, record);
    this.revision += 1;
    this.snap = { records: this.records, busy: [...this.records.values()].some((r) => r.running), revision: this.revision };
    for (const listener of [...this.listeners]) listener();
  }

  get(path: string): ScenarioRunRecord | undefined {
    return this.records.get(path);
  }

  /** Runs the scenario file `path` (its text from the editor when given, else the working copy); resolves with the record. */
  run(workspace: ProjectWorkspace, path: string, text?: string): Promise<ScenarioRunRecord> {
    this.set({ path, running: true });
    const result = this.chain.then(() => this.runNow(workspace, path, text));
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async runNow(workspace: ProjectWorkspace, path: string, text: string | undefined): Promise<ScenarioRunRecord> {
    const source = text ?? workspace.model.read(path) ?? '';
    let scenario: unknown;
    try {
      scenario = JSON.parse(source);
    } catch (e) {
      return this.finish({ path, running: false, error: `${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
    }
    try {
      const files = deployableFiles(workspace).filter((f) => classifyFile(f.path) !== 'scenario');
      const response = await connection.require().devRunScenario(files, scenario);
      return this.finish({ path, running: false, response });
    } catch (e) {
      const problems = e instanceof RuntimeApiError ? (e.problem as { problems?: EngineProblem[] } | undefined)?.problems : undefined;
      return this.finish({ path, running: false, error: errorMessage(e), ...(problems ? { problems } : {}) });
    }
  }

  private finish(record: ScenarioRunRecord): ScenarioRunRecord {
    const done = { ...record, at: Date.now() };
    this.set(done);
    return done;
  }

  clear(): void {
    this.records = new Map();
    this.revision += 1;
    this.snap = { records: this.records, busy: false, revision: this.revision };
    for (const listener of [...this.listeners]) listener();
  }
}

export const scenarioResults = new ScenarioResults();
