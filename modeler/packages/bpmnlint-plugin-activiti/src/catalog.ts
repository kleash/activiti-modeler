import type { RuleDef } from './define';
import { expressionRules } from './rules/expressions';
import { extensionRules } from './rules/extensions';
import { fileRules } from './rules/file-rules';
import { foreignRules } from './rules/foreign';
import { hiddenRules } from './rules/hidden';
import { eventRules } from './rules/validator-events';
import { modelRules } from './rules/validator-model';
import { trapRules } from './rules/traps';
import { structureRules } from './rules/validator-structure';
import { taskRules } from './rules/validator-tasks';

/** Every Activiti rule, in documentation order. */
export const RULES: readonly RuleDef[] = [...modelRules, ...structureRules, ...eventRules, ...taskRules, ...hiddenRules, ...foreignRules, ...expressionRules, ...extensionRules, ...trapRules, ...fileRules];

export const RULES_BY_ID: ReadonlyMap<string, RuleDef> = new Map(RULES.map((r) => [r.id, r]));

if (RULES_BY_ID.size !== RULES.length) {
  const seen = new Set<string>();
  const dup = RULES.find((r) => (seen.has(r.id) ? true : (seen.add(r.id), false)));
  throw new Error(`duplicate lint rule id ${dup?.id}`);
}
