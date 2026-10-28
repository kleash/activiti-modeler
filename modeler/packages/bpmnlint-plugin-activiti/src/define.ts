import { lintContextOf } from './context';
import { fixLabel } from './fix-ids';
import { definitionsOf, idOf } from './model';
import type { Fixture, LintContext, ME, RuleCategory } from './types';

/** Where the rule pages live; `meta.documentation.url` of every rule points to `<base><rule>.md`. */
export const DOCS_BASE = 'https://github.com/kleash/activiti-modeler/blob/main/docs/user-guide/lint-rules/';
export const docsUrl = (ruleId: string): string => `${DOCS_BASE}${ruleId}.md`;

export interface ReportExtra {
  /** Property accessor key of the panel entry to focus. */
  entryId?: string;
  /** Quick fix id (see fix-ids.ts); defaults to the rule's `quickFix`. */
  fix?: string;
  /** Details a quick fix needs. */
  data?: Record<string, unknown>;
}

export interface RuleApi {
  ctx: LintContext;
  definitions: ME | undefined;
  /** Reports a problem on `target` (an element, or an element id). */
  report(target: ME | string, message: string, extra?: ReportExtra): void;
}

export interface RuleSpec {
  /** Rule name inside the plugin (`activiti/<id>`), kebab-case. */
  id: string;
  /** `V` mirrors a ProcessValidator problem key; `L<n>` is a numbered rule of FEATURE_MATRIX §D / R1 §7.1; `C` hides a construct of §C; `X` is a trap found in the engine findings. */
  tag: string;
  /** ProcessValidator problem key mirrored by the rule; shown in the message. */
  key?: string;
  severity: RuleCategory;
  /** One line: what the rule finds. */
  title: string;
  /** Why it matters, with the evidence. */
  why: string;
  /** Pointers to the evidence: `R1 §0.1-2`, `engine-findings 28`, ... */
  evidence: string[];
  /** How to fix it by hand. */
  howToFix: string;
  /** The fix offered in the Problems panel. */
  quickFix?: string;
  /** Default panel entry to focus. */
  entry?: string;
  /** Keys under which the server (`/api/dev/validate`) reports the same finding, for the merge. */
  serverKeys?: string[];
  /** `bpmn` rules run inside bpmnlint over a process document; `file` rules are implemented in project.ts / rules/file-rules.ts and run over project files (DMN, sidecars). */
  target?: 'bpmn' | 'file';
  /** Where the rule gets its input besides the BPMN document. */
  needs?: Array<'extensions' | 'project' | 'text' | 'server'>;
  /** Called for every node of the document (and the diagram). */
  check(node: ME, api: RuleApi): void;
  bad: Fixture[];
  good: Fixture[];
}

export interface RuleDef extends RuleSpec {
  /** bpmnlint rule factory (what the resolver hands to the Linter). */
  factory: () => { meta: { documentation: { url: string } }; check: (node: ME, reporter: { report: (id: string, message: string, extra?: object) => void }) => void };
}

export function defineRule(spec: RuleSpec): RuleDef {
  const factory: RuleDef['factory'] = () => ({
    meta: { documentation: { url: docsUrl(spec.id) } },
    check(node, reporter) {
      const ctx = lintContextOf(node);
      const definitions = definitionsOf(node);
      const api: RuleApi = {
        ctx,
        definitions,
        report(target, message, extra = {}) {
          const id = typeof target === 'string' ? target : idOf(target);
          const fix = extra.fix ?? spec.quickFix;
          reporter.report(id ?? '', spec.key ? `${message} [${spec.key}]` : message, {
            ...(extra.entryId ?? spec.entry ? { entryId: extra.entryId ?? spec.entry } : {}),
            ...(spec.key ? { key: spec.key } : {}),
            ...(fix ? { fix: { id: fix, label: fixLabel(fix) } } : {}),
            ...(extra.data ? { data: extra.data } : {}),
          });
        },
      };
      spec.check(node, api);
    },
  });
  return { ...spec, factory };
}

/** Runs a check once, on the `bpmn:Definitions` root (for rules that look at the whole document). */
export const onDefinitions = (fn: (definitions: ME, api: RuleApi) => void): RuleSpec['check'] => (node, api) => {
  if (node.$type === 'bpmn:Definitions') fn(node, api);
};

/** Runs a check for every node that is an instance of one of `types`. */
export const onTypes = (types: string | readonly string[], fn: (node: ME, api: RuleApi) => void): RuleSpec['check'] => {
  const list = typeof types === 'string' ? [types] : types;
  return (node, api) => {
    if (list.some((t) => node.$instanceOf(t))) fn(node, api);
  };
};
