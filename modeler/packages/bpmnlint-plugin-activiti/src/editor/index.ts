/**
 * bpmn-js integration of the lint: a didi module that
 *  - runs the Activiti rules (with the live extensions store as context) in place of the plain bpmnlint run of
 *    `bpmn-js-bpmnlint`, so the canvas overlays show Activiti problems and the server's "engine" problems,
 *  - lints on a debounce after every change and after an import,
 *  - fires `activiti.lint.completed` with the normalised problems,
 *  - turns a click on a problem into a selection and an `activiti.lint.focus` event, and
 *  - applies the quick fixes as undoable commands.
 *
 * Events (on the bpmn-js eventBus):
 *  - `activiti.lint.completed` `{ problems: Problem[] }`
 *  - `activiti.lint.focus` `{ elementId?: string, entryId?: string, rule?: string }`: the properties panel opens the group of
 *    the entry (an accessor key such as `impl.class`, see ACCESSORS in bpmn-js-activiti) and focuses its field.
 */
import lintingModule from 'bpmn-js-bpmnlint';
import type { BpmnlintReport } from 'bpmnlint';

import { duplicateIdsFromWarnings, unresolvedFromWarnings } from '../context';
import { lintRaw, toProblems } from '../linter';
import { mergeServerProblems, type ServerProblem } from '../server';
import { severityToCategory, type LintContext, type ME, type Problem } from '../types';
import { applyFix, type FixResult } from './fixes';

export const LINT_COMPLETED = 'activiti.lint.completed';
export const LINT_FOCUS = 'activiti.lint.focus';
export type { FixResult } from './fixes';

interface EventBus {
  on(event: string | string[], priority: number | ((e: never) => void), handler?: (e: never) => void): void;
  once(event: string, callback: (e: never) => void): void;
  fire(event: string, data?: Record<string, unknown>): unknown;
}

interface Injector {
  get<T>(name: string, strict?: boolean): T;
}

interface DiagramElementLike {
  id: string;
  businessObject?: ME;
}

interface LintingService {
  lint(): Promise<Record<string, BpmnlintReport[]>>;
  update(): void;
  _addEntry($ul: HTMLElement, state: string, entry: BpmnlintReport & { actualElementId?: string }): void;
}

export interface ActivitiLintConfig {
  /** Delay between a change and the lint run, in milliseconds (default 350). */
  delay?: number;
}

const toRaw = (problems: readonly Problem[], rootId: string): Record<string, BpmnlintReport[]> => {
  const raw: Record<string, BpmnlintReport[]> = {};
  for (const p of problems) {
    (raw[p.rule] ??= []).push({
      id: p.elementId ?? rootId,
      message: p.message,
      category: severityToCategory(p.severity),
      ...(p.documentationUrl ? { meta: { documentation: { url: p.documentationUrl } } } : {}),
      ...(p.entryId ? { entryId: p.entryId } : {}),
      problemId: p.id,
    });
  }
  return raw;
};

export class ActivitiLinting {
  static $inject = ['eventBus', 'linting', 'bpmnjs', 'canvas', 'selection', 'elementRegistry', 'injector', 'config.activitiLint'];

  /** The problems of the last run. */
  problems: Problem[] = [];
  private context: Partial<LintContext> = {};
  private serverProblems: ServerProblem[] = [];
  private unresolved: LintContext['unresolved'] = new Map();
  private duplicateIds: NonNullable<LintContext['duplicateIds']> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly delay: number;
  private readonly originalUpdate: () => void;

  constructor(
    private readonly eventBus: EventBus,
    private readonly linting: LintingService,
    private readonly bpmnjs: { getDefinitions(): ME | undefined },
    private readonly canvas: { getRootElement(): DiagramElementLike; getContainer(): HTMLElement; scrollToElement?(element: unknown, padding?: unknown): void },
    private readonly selection: { select(element: unknown): void },
    private readonly elementRegistry: { get(id: string): DiagramElementLike | undefined },
    private readonly injector: Injector,
    config?: ActivitiLintConfig,
  ) {
    this.delay = config?.delay ?? 350;

    linting.lint = () => this.lint();
    this.originalUpdate = linting.update.bind(linting);
    linting.update = () => this.schedule();

    // before bpmn-js-bpmnlint's own listener (low priority) updates
    eventBus.on('import.done', 1000, ((event: { warnings?: Array<{ message?: string; element?: ME; property?: string; value?: string }> }) => {
      this.unresolved = unresolvedFromWarnings(event.warnings ?? []);
      this.duplicateIds = duplicateIdsFromWarnings(event.warnings ?? []);
    }) as never);
    // the extensions JSON changes without a changed element
    eventBus.on(['commandStack.changed', 'activiti.extensions.changed'], 400, (() => this.schedule()) as never);
    eventBus.on('linting.completed', ((event: { issues: unknown }) => {
      void event;
      eventBus.fire(LINT_COMPLETED, { problems: this.problems });
    }) as never);
    eventBus.on('diagram.destroy', (() => clearTimeout(this.timer)) as never);

    // a click on an entry of the overlay list focuses the problem
    const original = linting._addEntry.bind(linting);
    linting._addEntry = ($ul, state, entry) => {
      original($ul, state, entry);
      const li = $ul.lastElementChild as HTMLElement | null;
      if (li) {
        li.dataset['elementId'] = entry.actualElementId ?? entry.id ?? '';
        if (typeof entry['entryId'] === 'string') li.dataset['entryId'] = entry['entryId'];
        li.classList.add('activiti-lint-entry');
      }
    };
    canvas.getContainer().addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('a')) return;
      const li = target?.closest<HTMLElement>('li.activiti-lint-entry');
      if (!li) return;
      this.focus({ elementId: li.dataset['elementId'], entryId: li.dataset['entryId'], rule: li.dataset['rule'] });
    });
  }

  /** Facts about the document that the extensions store and the model cannot tell: its path, the project, the file text. */
  setContext(context: Partial<LintContext>): void {
    this.context = { ...this.context, ...context };
    this.schedule();
  }

  /** The problems the server reported for this file (merged into the result, tagged engine). */
  setServerProblems(problems: readonly ServerProblem[]): void {
    this.serverProblems = [...problems];
    this.schedule();
  }

  /** Lints now and resolves with the problems when the overlays are updated. */
  lintNow(): Promise<Problem[]> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.bpmnjs.getDefinitions()) return Promise.resolve([]);
    return new Promise((resolve) => {
      this.eventBus.once(LINT_COMPLETED, () => resolve(this.problems));
      this.originalUpdate();
    });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.originalUpdate();
    }, this.delay);
  }

  async lint(): Promise<Record<string, BpmnlintReport[]>> {
    const definitions = this.bpmnjs.getDefinitions();
    if (!definitions) return {};
    const store = this.injector.get<{ model: LintContext['extensions'] } | undefined>('extensionsStore', false);
    const path = this.context.path ?? '';
    const context: LintContext = {
      ...this.context,
      ...(store?.model ? { extensions: store.model } : {}),
      unresolved: this.unresolved,
      duplicateIds: this.duplicateIds,
    };
    const client = toProblems(await lintRaw(definitions, { context, path }), path);
    this.problems = mergeServerProblems(
      client,
      this.serverProblems.filter((p) => (p.path ?? path) === path),
      path,
    );
    return toRaw(this.problems, definitions.id ?? this.canvas.getRootElement().id);
  }

  /** Selects the element of a problem and asks the properties panel to focus the field of its entry. */
  focus(target: { elementId?: string | undefined; entryId?: string | undefined; rule?: string | undefined }): void {
    const element = target.elementId ? this.elementRegistry.get(target.elementId) : undefined;
    if (element) {
      this.selection.select(element);
      this.canvas.scrollToElement?.(element);
    }
    this.eventBus.fire(LINT_FOCUS, { elementId: element?.id ?? target.elementId, ...(target.entryId ? { entryId: target.entryId } : {}), ...(target.rule ? { rule: target.rule } : {}) });
  }

  /** Applies the quick fix of a problem as one undoable command. */
  applyFix(problem: Problem): FixResult {
    const result = applyFix(this.injector, problem);
    if (result.ok) this.schedule();
    return result;
  }
}

/** didi module: `new BpmnModeler({ additionalModules: [ActivitiModule, ActivitiLintModule], linting: { active: true } })`. */
export const ActivitiLintModule = {
  __depends__: [lintingModule],
  __init__: ['activitiLinting'],
  activitiLinting: ['type', ActivitiLinting],
};
