import { Linter, type BpmnlintReport, type LinterConfig } from 'bpmnlint';
import recommendedCore from 'bpmnlint/config/recommended';
import StaticResolver from 'bpmnlint/lib/resolver/static-resolver';

import { clearLintContext, setLintContext } from './context';
import { CORE_RULES } from './core-rules';
import { DOCS_BASE, type RuleDef } from './define';
import { fixLabel } from './fix-ids';
import { RULES, RULES_BY_ID } from './catalog';
import { categoryToSeverity, type LintContext, type ME, type Problem } from './types';

export const PLUGIN_PACKAGE = 'bpmnlint-plugin-activiti';

/**
 * Core bpmnlint rules the `activiti:recommended` config changes. The first four are FEATURE_MATRIX §D item 3. The rest is a
 * deliberate deviation (docs/user-guide/lint-rules/index.md): they describe style, not execution, and an `error` blocks a
 * deployment, so they are warnings (the engine runs those models); one is `off` because a ProcessValidator mirror says the
 * same thing under the engine's key.
 */
export const CORE_TUNING: Record<string, 'off' | 'error' | 'warn'> = {
  // FEATURE_MATRIX §D item 3
  'no-inclusive-gateway': 'off',
  'no-complex-gateway': 'error',
  'ad-hoc-sub-process': 'error',
  'event-sub-process-typed-start-event': 'error',
  // style: Activiti runs these models as drawn
  'label-required': 'warn',
  'end-event-required': 'warn',
  'no-implicit-end': 'warn',
  'no-implicit-start': 'warn',
  'no-implicit-split': 'warn',
  'no-gateway-join-fork': 'warn',
  'no-duplicate-sequence-flows': 'warn',
  'conditional-flows': 'warn',
  // a new process is a lone start event; an unconnected element does not stop the engine
  'no-disconnected': 'warn',
  // START_EVENT_MULTIPLE_FOUND says it with the engine's key
  'single-blank-start-event': 'off',
};

/** Why a core rule matters for Activiti; appended to the rule's own message and linked to our page. */
export const CORE_NOTES: Record<string, string> = {
  'no-complex-gateway': 'Activiti runs a complex gateway as an exclusive gateway (R1 §0.1-4)',
  'ad-hoc-sub-process': 'BPMN allows no start or end event in an ad-hoc sub process; the sub process hangs in Activiti 9 (R1 §0.1-5)',
  'event-sub-process-typed-start-event': 'an event sub process needs an error or message start event (R1 §3.5)',
};

/** bpmnlint's own `recommended` config (the file of the package, read statically). */
const RECOMMENDED_CORE = recommendedCore.rules;

/** Quick fixes for core rules (the Activiti rules name theirs themselves). */
export const CORE_FIXES: Record<string, string> = {
  'no-complex-gateway': 'complex-to-exclusive',
};

/** The `activiti:recommended` config: bpmnlint `recommended`, tuned, plus every Activiti rule at its default severity. */
export const RECOMMENDED = {
  extends: 'bpmnlint:recommended',
  rules: {
    ...Object.fromEntries(Object.entries(CORE_TUNING).map(([name, level]) => [`bpmnlint/${name}`, level])),
    ...Object.fromEntries(RULES.map((rule) => [`activiti/${rule.id}`, rule.severity])),
  },
} as LinterConfig;

export function createResolver(): StaticResolver {
  const cache: Record<string, unknown> = {};
  for (const [name, factory] of Object.entries(CORE_RULES)) cache[`rule:bpmnlint/${name}`] = factory;
  for (const rule of RULES) cache[`rule:${PLUGIN_PACKAGE}/${rule.id}`] = rule.factory;
  cache['config:bpmnlint/recommended'] = { rules: RECOMMENDED_CORE };
  cache[`config:${PLUGIN_PACKAGE}/recommended`] = RECOMMENDED;
  cache[`config:${PLUGIN_PACKAGE}/all`] = { rules: Object.fromEntries(RULES.map((r) => [`activiti/${r.id}`, r.severity])) };
  return new StaticResolver(cache);
}

/** Config that enables `rule` (a plugin rule id, or `bpmnlint/<name>`) and nothing else. */
export const onlyRule = (rule: string, level: 'error' | 'warn' | 'info' = 'error'): LinterConfig => ({ rules: { [rule]: level } });

export const recommendedConfig = (): LinterConfig => ({ extends: `plugin:activiti/recommended` });

const sharedResolver = createResolver();

/**
 * A Linter bound to the plugin's rules. A new one per run: the Linter caches rule instances, and several bpmnlint rules keep
 * state in their closure (no-duplicate-sequence-flows, ...), which must not leak from one document to the next.
 */
export function getLinter(): Linter {
  return new Linter({
    resolver: sharedResolver,
    transformRule(rule, { pkg, ruleName }) {
      // tuned core rules point at our page, which explains what the rule means for Activiti
      if (pkg === 'bpmnlint' && ruleName in CORE_NOTES) {
        const r = rule as { meta?: { documentation?: { url?: string } } };
        r.meta = { ...r.meta, documentation: { url: `${DOCS_BASE}bpmnlint-${ruleName}.md` } };
      }
      return rule;
    },
  });
}

export interface LintOptions {
  context?: LintContext;
  config?: LinterConfig;
  /** Path of the file, stored in the problems. */
  path?: string;
}

/**
 * bpmnlint's structural rules read `incoming` / `outgoing` of the flow nodes, but those lists are optional in BPMN XML and
 * Activiti does not need them (hand-written files and many tools omit them). For the duration of a lint run every flow node
 * gets the links its sequence flows imply; the lists are put back afterwards, so the document is not changed.
 */
async function withFlowLinks<T>(definitions: ME, run: () => Promise<T>): Promise<T> {
  const saved: Array<{ node: ME; property: 'incoming' | 'outgoing'; had: boolean; value: unknown }> = [];
  const link = (node: ME, property: 'incoming' | 'outgoing', flow: ME): void => {
    const own = Object.prototype.hasOwnProperty.call(node, property);
    let entry = saved.find((s) => s.node === node && s.property === property);
    if (!entry) {
      entry = { node, property, had: own, value: own ? node[property] : undefined };
      saved.push(entry);
      node[property] = own && Array.isArray(entry.value) ? [...(entry.value as ME[])] : [];
    }
    const list = node[property] as ME[];
    if (!list.includes(flow)) list.push(flow);
  };
  const visit = (container: ME): void => {
    for (const element of (container.get('flowElements') as ME[] | undefined) ?? []) {
      if (element.$instanceOf('bpmn:SequenceFlow')) {
        const source = element.get('sourceRef') as ME | undefined;
        const target = element.get('targetRef') as ME | undefined;
        if (source) link(source, 'outgoing', element);
        if (target) link(target, 'incoming', element);
      } else if (element.$instanceOf('bpmn:SubProcess')) visit(element);
    }
  };
  for (const root of (definitions.get('rootElements') as ME[] | undefined) ?? []) if (root.$instanceOf('bpmn:Process')) visit(root);
  try {
    return await run();
  } finally {
    for (const { node, property, had, value } of saved) {
      if (had) node[property] = value;
      else delete node[property];
    }
  }
}

/** Runs the rules over a parsed document and returns bpmnlint's raw result (rule name -> reports). */
export async function lintRaw(definitions: ME, options: LintOptions = {}): Promise<Record<string, BpmnlintReport[]>> {
  const context: LintContext = { ...(options.context ?? {}), ...(options.path !== undefined && options.context?.path === undefined ? { path: options.path } : {}) };
  setLintContext(definitions, context);
  try {
    // the Linter resolves its rules and applies them in microtasks only, so nothing else runs between the patch and the restore
    return await withFlowLinks(definitions, () => getLinter().lint(definitions, options.config ?? recommendedConfig()));
  } finally {
    clearLintContext(definitions);
  }
}

/** Turns bpmnlint's result into problems. */
export function toProblems(raw: Record<string, BpmnlintReport[]>, path = ''): Problem[] {
  const problems: Problem[] = [];
  const counter = new Map<string, number>();
  for (const [ruleName, reports] of Object.entries(raw)) {
    const rule = ruleName.includes('/') ? ruleName : `bpmnlint/${ruleName}`;
    const def: RuleDef | undefined = ruleName.startsWith('activiti/') ? RULES_BY_ID.get(ruleName.slice('activiti/'.length)) : undefined;
    const coreName = ruleName.includes('/') ? undefined : ruleName;
    for (const report of reports) {
      const base = `${path}|${rule}|${report.id ?? ''}`;
      const n = (counter.get(base) ?? 0) + 1;
      counter.set(base, n);
      const note = coreName ? CORE_NOTES[coreName] : undefined;
      const problem: Problem = {
        id: `${base}|${n}`,
        path,
        ...(report.id ? { elementId: report.id } : {}),
        rule,
        ...(typeof report['key'] === 'string' ? { key: report['key'] } : {}),
        severity: report.category === 'rule-error' ? 'error' : categoryToSeverity(report.category),
        message: note ? `${report.message}: ${note}` : report.message,
        source: 'client',
        ...(typeof report['entryId'] === 'string' ? { entryId: report['entryId'] } : {}),
        ...(report['fix'] ? { fix: report['fix'] as { id: string; label: string } } : {}),
        documentationUrl: report.meta?.documentation?.url ?? (def ? `${DOCS_BASE}${def.id}.md` : undefined),
        ...(report['data'] ? { data: report['data'] as Record<string, unknown> } : {}),
      };
      if (!problem.documentationUrl) delete problem.documentationUrl;
      const coreFix = coreName ? CORE_FIXES[coreName] : undefined;
      if (coreFix && !problem.fix) problem.fix = { id: coreFix, label: fixLabel(coreFix) };
      problems.push(problem);
    }
  }
  return problems;
}

/** Lints a parsed document and returns problems. */
export async function lintDefinitions(definitions: ME, options: LintOptions = {}): Promise<Problem[]> {
  return toProblems(await lintRaw(definitions, options), options.path ?? options.context?.path ?? '');
}
