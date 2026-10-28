// @vitest-environment jsdom
/**
 * Invariants of the rule catalog: the numbered rules L1 to L37 of FEATURE_MATRIX §D are all implemented, every engine
 * problem key has a rule, every construct the support matrix hides has a rule, and the entry a problem points to is a
 * field the properties panel has (an accessor key).
 */
import { ACCESSORS } from '@activiti-modeler/bpmn-js-activiti';
import { HIDDEN_RULES } from '@activiti-modeler/bpmn-js-activiti/support-matrix';
import { describe, expect, it } from 'vitest';

import { RULES, RULES_BY_ID } from './catalog';
import { CORE_RULES } from './core-rules';
import { NUMBERED } from './docs';
import { ENGINE_PROBLEM_KEYS, UNREACHABLE_PROBLEM_KEYS } from './engine-keys';
import { HIDDEN_COVERAGE } from './rules/hidden';
import { lintFixture } from './testing';

const accessorKeys = new Set(ACCESSORS.map((a) => a.key));

describe('rule catalog', () => {
  it('has a rule for each of L1 to L37', () => {
    expect(NUMBERED.map(([n]) => n)).toEqual(Array.from({ length: 37 }, (_, i) => `L${i + 1}`));
    for (const [n, , ids] of NUMBERED) {
      expect(ids.length, n).toBeGreaterThan(0);
      for (const id of ids) {
        if (id.startsWith('bpmnlint/')) expect(CORE_RULES, `${n}: ${id}`).toHaveProperty([id.slice('bpmnlint/'.length)]);
        else expect(RULES_BY_ID.has(id), `${n}: activiti/${id}`).toBe(true);
      }
    }
  });

  it('tags a rule with its number, so the numbers in the tags and in the table agree', () => {
    const inTable = new Map<string, string[]>();
    for (const [n, , ids] of NUMBERED) for (const id of ids) inTable.set(id, [...(inTable.get(id) ?? []), n]);
    for (const rule of RULES.filter((r) => /^L\d+$/.test(r.tag))) expect(inTable.get(rule.id), `${rule.id} (${rule.tag})`).toContain(rule.tag);
  });

  it('has one rule for each ProcessValidator problem key, with the same severity as the engine', () => {
    const keys = new Map(RULES.filter((r) => r.key).map((r) => [r.key!, r]));
    expect(ENGINE_PROBLEM_KEYS.length).toBe(78); // 79 keys in Problems, one of them (EVENT_LISTENER_INVALID_IMPLEMENTATION) is unreachable from XML
    for (const key of ENGINE_PROBLEM_KEYS) expect(keys.has(key), key).toBe(true);
    for (const key of Object.keys(UNREACHABLE_PROBLEM_KEYS)) expect(keys.has(key), `${key} is unreachable from XML: no rule`).toBe(false);
  });

  it('has a rule for every construct the support matrix hides', () => {
    for (const hidden of HIDDEN_RULES) {
      const rule = HIDDEN_COVERAGE[hidden.id];
      expect(rule, `no rule for the hidden construct ${hidden.id}`).toBeDefined();
      if (rule!.startsWith('activiti/')) expect(RULES_BY_ID.has(rule!.slice('activiti/'.length)), rule).toBe(true);
      else expect(CORE_RULES, rule).toHaveProperty([rule!.slice('bpmnlint/'.length)]);
    }
  });

  it('names a field of the properties panel in every `entry`, and in every entryId a problem carries', async () => {
    for (const rule of RULES) {
      if (rule.entry) expect(accessorKeys.has(rule.entry), `${rule.id}: ${rule.entry}`).toBe(true);
      if (rule.target === 'file') continue;
      for (const fixture of rule.bad) {
        for (const problem of await lintFixture(rule.id, fixture, rule.severity)) {
          if (problem.entryId) expect(accessorKeys.has(problem.entryId), `${rule.id}: ${problem.entryId}`).toBe(true);
        }
      }
    }
  });

  it('gives every rule a title, an explanation, evidence and a fix', () => {
    for (const rule of RULES) {
      expect(rule.title.length, rule.id).toBeGreaterThan(5);
      expect(rule.why.length, rule.id).toBeGreaterThan(20);
      expect(rule.evidence.length, rule.id).toBeGreaterThan(0);
      expect(rule.howToFix.length, rule.id).toBeGreaterThan(5);
    }
  });
});
