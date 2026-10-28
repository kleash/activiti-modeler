/**
 * The lint of the app: one place that knows the problems of every file of the open project.
 *
 *  - An open BPMN editor lints its live model (the `activitiLinting` service of its modeler) and reports through
 *    `activiti.lint.completed`; those problems are the truth for that file.
 *  - Every other file (closed processes, DMN, sidecars) is linted by `lintProject()` from the working copies of the
 *    workspace, debounced after every change.
 *  - When a `ServerValidator` is set (the modeler server connection sets one), its problems are merged in, tagged `engine`.
 *
 * `checkDeployable()` is the gate a deployment passes: a full, fresh lint of the project (the open diagrams from their editors, the rest from
 * the workspace) plus the server validation. The server validation sends the working copies of the workspace: save the open editors first.
 */
import { classifyFile, type ProjectFile, type ProjectWorkspace } from '@activiti-modeler/activiti-project';
import {
  buildProjectIndex, countProblems, lintProject, mergeServerProblems, type FixResult, type LintContext, type Problem, type ProjectIndex, type ServerProblem, type ServerValidator,
} from '@activiti-modeler/bpmnlint-plugin-activiti';

export const LINT_FOCUS_WINDOW_EVENT = 'activiti.lint.focus';

/** What the service needs of the `activitiLinting` service of a modeler. */
export interface LintingLike {
  setContext(context: Partial<LintContext>): void;
  setServerProblems(problems: readonly ServerProblem[]): void;
  focus(target: { elementId?: string | undefined; entryId?: string | undefined; rule?: string | undefined }): void;
  applyFix(problem: Problem): FixResult;
  lintNow(): Promise<Problem[]>;
}

interface EventBusLike {
  on(event: string, handler: (event: { problems: Problem[] }) => void): void;
  off(event: string, handler: (event: { problems: Problem[] }) => void): void;
}

export interface LintModelerLike {
  get<T>(name: string): T;
}

export interface LintHost {
  workspace(): ProjectWorkspace | undefined;
  /** Opens the file in a tab (its diagram for a process) and shows it. */
  openFile(path: string): void;
  toast(message: string, kind?: 'info' | 'success' | 'error', detail?: string): void;
}

export interface LintSnapshot {
  problems: Problem[];
  counts: { error: number; warning: number; info: number };
  /** Paths that have at least one problem, sorted. */
  files: string[];
  linting: boolean;
  server: { available: boolean; status: 'idle' | 'running' | 'done' | 'error'; message?: string; checkedAt?: number };
  /** Bumps when the shell should show the Problems tab (status bar click, deploy gate). */
  showRequest: number;
  revision: number;
}

interface Registration {
  token: number;
  path: () => string;
  modeler: LintModelerLike;
  linting: LintingLike;
  problems?: Problem[];
  detach: () => void;
}

const PROJECT_DELAY_MS = 500;
const FOCUS_WAIT_MS = 5000;

/** project.json is read, not linted: the version of a connector's templates is kept there (ADR 0003). */
const isLintable = (path: string): boolean => path === 'project.json' || ['bpmn', 'dmn', 'extensions', 'connector'].includes(classifyFile(path));

export class LintService {
  private host?: LintHost;
  private readonly listeners = new Set<() => void>();
  private registrations = new Map<number, Registration>();
  private nextToken = 1;
  private projectProblems: Record<string, Problem[]> = {};
  private index?: ProjectIndex;
  private serverValidator?: ServerValidator;
  private serverProblems: ServerProblem[] = [];
  private asyncExecutorActive: boolean | undefined;
  private serverState: LintSnapshot['server'] = { available: false, status: 'idle' };
  private linting = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastRevision = -1;
  private lastWorkspace?: ProjectWorkspace;
  private runId = 0;
  private showRequest = 0;
  private revision = 0;
  private snap: LintSnapshot = this.build();
  private waiters: Array<{ path: string; resolve: (r: Registration | undefined) => void; timer: ReturnType<typeof setTimeout> }> = [];

  // --- React binding ---------------------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LintSnapshot => this.snap;

  private emit(): void {
    this.revision += 1;
    this.snap = this.build();
    for (const listener of [...this.listeners]) listener();
  }

  private build(): LintSnapshot {
    const problems = this.merged();
    const files = [...new Set(problems.map((p) => p.path))].sort();
    return { problems, counts: countProblems(problems), files, linting: this.linting, server: this.serverState, showRequest: this.showRequest, revision: this.revision };
  }

  // --- wiring ----------------------------------------------------------------------------------------------------------

  bind(host: LintHost): void {
    this.host = host;
  }

  /** Called whenever the app state changes; relints the project when its files changed. */
  onAppChange(): void {
    const ws = this.host?.workspace();
    const revision = ws?.model.revision ?? -1;
    if (ws === this.lastWorkspace && revision === this.lastRevision) return;
    if (ws !== this.lastWorkspace) {
      this.projectProblems = {};
      this.index = undefined;
      this.serverProblems = [];
      this.serverState = { available: !!this.serverValidator, status: 'idle' };
    }
    this.lastWorkspace = ws;
    this.lastRevision = revision;
    this.schedule();
  }

  private schedule(delay = PROJECT_DELAY_MS): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.runProject(), delay);
  }

  /** Registers the lint of an open BPMN editor. Returns the function that unregisters it. */
  attach(path: () => string, modeler: LintModelerLike): () => void {
    const token = this.nextToken++;
    const linting = modeler.get<LintingLike>('activitiLinting');
    const bus = modeler.get<EventBusLike>('eventBus');
    const onCompleted = (event: { problems: Problem[] }): void => {
      const reg = this.registrations.get(token);
      if (reg) {
        reg.problems = event.problems;
        this.emit();
      }
    };
    bus.on('activiti.lint.completed', onCompleted);
    const registration: Registration = {
      token,
      path,
      modeler,
      linting,
      detach: () => {
        bus.off('activiti.lint.completed', onCompleted);
        this.registrations.delete(token);
        this.emit();
      },
    };
    this.registrations.set(token, registration);
    this.pushContext(registration);
    for (const waiter of this.waiters.filter((w) => w.path === path())) {
      clearTimeout(waiter.timer);
      waiter.resolve(registration);
    }
    this.waiters = this.waiters.filter((w) => w.path !== path());
    void linting.lintNow().catch(() => undefined);
    return registration.detach;
  }

  private pushContext(reg: Registration): void {
    const ws = this.host?.workspace();
    const path = reg.path();
    reg.linting.setContext({
      path,
      ...(this.index ? { project: this.index } : {}),
      ...(ws ? { text: ws.model.saved(path) ?? ws.model.read(path) ?? '' } : {}),
      ...(this.asyncExecutorActive !== undefined ? { asyncExecutorActive: this.asyncExecutorActive } : {}),
    });
    reg.linting.setServerProblems(this.serverProblems.filter((p) => (p.path ?? '') === path));
  }

  // --- project lint ----------------------------------------------------------------------------------------------------

  private files(): ProjectFile[] {
    const ws = this.host?.workspace();
    if (!ws) return [];
    const paths = ws.model.paths();
    // a project.json that is not saved yet (the connector editor made it) is part of the project too
    if (!paths.includes('project.json') && ws.model.isDirty('project.json')) paths.push('project.json');
    return paths
      .filter(isLintable)
      .map((path) => ({ path, content: ws.model.read(path) ?? '' }));
  }

  private liveBpmnPaths(): Set<string> {
    return new Set([...this.registrations.values()].filter((r) => r.problems !== undefined).map((r) => r.path()));
  }

  private async runProject(): Promise<void> {
    const run = ++this.runId;
    const files = this.files();
    if (!this.host?.workspace()) {
      this.projectProblems = {};
      this.index = undefined;
      this.emit();
      return;
    }
    this.linting = true;
    this.emit();
    try {
      const live = this.liveBpmnPaths();
      const result = await lintProject(files, {
        only: files.map((f) => f.path).filter((p) => !live.has(p)),
        ...(this.asyncExecutorActive !== undefined ? { asyncExecutorActive: this.asyncExecutorActive } : {}),
      });
      if (run !== this.runId) return;
      this.projectProblems = result.byFile;
      this.index = result.index ?? (await buildProjectIndex(files));
      for (const reg of this.registrations.values()) this.pushContext(reg);
    } catch (e) {
      this.host.toast('The lint of the project failed', 'error', e instanceof Error ? e.message : String(e));
    } finally {
      if (run === this.runId) {
        this.linting = false;
        this.emit();
      }
    }
  }

  /** Lints the project now and resolves when done (tests, the deploy gate). */
  async refresh(): Promise<LintSnapshot> {
    clearTimeout(this.timer);
    await this.runProject();
    await Promise.all([...this.registrations.values()].map((r) => r.linting.lintNow().catch(() => [])));
    return this.snap;
  }

  // --- the merged view ---------------------------------------------------------------------------------------------------

  private merged(): Problem[] {
    const out: Problem[] = [];
    const live = new Map<string, Problem[]>();
    for (const reg of this.registrations.values()) if (reg.problems) live.set(reg.path(), reg.problems);
    for (const [path, problems] of live) out.push(...problems.map((p) => ({ ...p, path })));
    for (const [path, problems] of Object.entries(this.projectProblems)) {
      if (live.has(path)) continue;
      out.push(...mergeServerProblems(problems, this.serverProblems.filter((s) => s.path === path), path));
    }
    // server problems for files neither linted nor live (the file list changed meanwhile) are kept too
    for (const path of new Set(this.serverProblems.map((s) => s.path ?? ''))) {
      if (live.has(path) || path in this.projectProblems) continue;
      out.push(...mergeServerProblems([], this.serverProblems.filter((s) => (s.path ?? '') === path), path));
    }
    const rank = { error: 0, warning: 1, info: 2 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path) || (a.elementId ?? '').localeCompare(b.elementId ?? '') || a.rule.localeCompare(b.rule));
  }

  // --- the server ---------------------------------------------------------------------------------------------------------

  /** Connects (or, with undefined, disconnects) the server validation. The modeler server connection calls this. */
  setServerValidator(validator: ServerValidator | undefined): void {
    this.serverValidator = validator;
    if (!validator) {
      this.serverProblems = [];
      this.asyncExecutorActive = undefined;
    }
    this.serverState = { available: !!validator, status: 'idle' };
    for (const reg of this.registrations.values()) this.pushContext(reg);
    this.emit();
  }

  /** Sends the project to the server's validation and merges the answer. Resolves with the server's problems. */
  async validateOnServer(): Promise<ServerProblem[]> {
    const validator = this.serverValidator;
    if (!validator) throw new Error('no modeler server is connected');
    this.serverState = { available: true, status: 'running' };
    this.emit();
    try {
      const response = await validator.validate(await this.exportFiles());
      this.serverProblems = response.problems;
      this.asyncExecutorActive = response.asyncExecutorActive;
      this.serverState = { available: true, status: 'done', checkedAt: Date.now() };
      for (const reg of this.registrations.values()) this.pushContext(reg);
      this.schedule(0);
      this.emit();
      return response.problems;
    } catch (e) {
      this.serverState = { available: true, status: 'error', message: e instanceof Error ? e.message : String(e) };
      this.emit();
      throw e;
    }
  }

  /** Problems the server reported outside of a validation (a deployment it refused): they are merged like the validation's, source `engine`. */
  setServerProblems(problems: readonly ServerProblem[]): void {
    this.serverProblems = [...problems];
    for (const reg of this.registrations.values()) this.pushContext(reg);
    this.schedule(0);
    this.emit();
  }

  /** The files a server validation or a deployment sends: the working copies of the workspace. */
  private async exportFiles(): Promise<ProjectFile[]> {
    return this.files().filter((f) => classifyFile(f.path) !== 'connector');
  }

  /**
   * The deploy gate: a full, fresh lint of the project plus the server's validation when one is connected. A deployment must not
   * start when `deployable` is false.
   */
  async checkDeployable(): Promise<{ deployable: boolean; problems: Problem[]; counts: LintSnapshot['counts'] }> {
    clearTimeout(this.timer);
    // the open diagrams are linted from their editors (their model and extensions as they are on the screen), the other files from the workspace
    await this.refresh();
    if (this.serverValidator) {
      await this.validateOnServer();
      // an open diagram reports the server's problems of its file through its own lint (see pushContext): let it run again with them, or
      // the gate would miss an engine error in a file that is open in an editor
      await Promise.all([...this.registrations.values()].map((r) => r.linting.lintNow().catch(() => [])));
    }
    const problems = this.merged();
    this.showRequest += 1;
    this.emit();
    const counts = countProblems(problems);
    return { deployable: counts.error === 0, problems, counts };
  }

  // --- actions on a problem ------------------------------------------------------------------------------------------------

  /** Asks the shell to show the Problems tab. */
  showProblems(): void {
    this.showRequest += 1;
    this.emit();
  }

  private whenAttached(path: string): Promise<Registration | undefined> {
    const present = [...this.registrations.values()].find((r) => r.path() === path);
    if (present) return Promise.resolve(present);
    return new Promise((resolve) => {
      const waiter = { path, resolve, timer: setTimeout(() => resolve(undefined), FOCUS_WAIT_MS) };
      this.waiters.push(waiter);
    });
  }

  /** Opens the file of a problem, selects its element and asks the properties panel to focus the entry. */
  async open(problem: Problem): Promise<void> {
    this.host?.openFile(problem.path);
    if (classifyFile(problem.path) !== 'bpmn') return;
    const reg = await this.whenAttached(problem.path);
    if (!reg) return;
    reg.linting.focus({ elementId: problem.elementId, entryId: problem.entryId, rule: problem.rule });
    if (problem.elementId) {
      window.dispatchEvent(new CustomEvent(LINT_FOCUS_WINDOW_EVENT, { detail: { elementId: problem.elementId, ...(problem.entryId ? { entryId: problem.entryId } : {}) } }));
    }
  }

  /** Applies the quick fix of a problem in the editor of its file (opening the file first). */
  async fix(problem: Problem): Promise<FixResult> {
    if (!problem.fix) return { ok: false, message: 'there is no quick fix' };
    if (classifyFile(problem.path) !== 'bpmn') return { ok: false, message: 'a quick fix needs the diagram editor' };
    this.host?.openFile(problem.path);
    const reg = await this.whenAttached(problem.path);
    if (!reg) return { ok: false, message: 'the editor of the file did not open' };
    // the details of a fix come from a lint of the current project: the problem the user clicked may predate a file that was just added
    await this.runProject();
    const fresh = await reg.linting.lintNow().catch(() => reg.problems ?? []);
    const current = fresh.find((p) => p.id === problem.id) ?? fresh.find((p) => p.rule === problem.rule && p.elementId === problem.elementId && p.message === problem.message) ?? problem;
    const result = reg.linting.applyFix(current);
    if (!result.ok) this.host?.toast(`The quick fix failed: ${result.message ?? 'unknown error'}`, 'error');
    return result;
  }
}

/** The service of the page. */
export const lintService = new LintService();
