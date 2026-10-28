import { describe, expect, it } from 'vitest';

import { variablesInExpression } from './index';

describe('variablesInExpression', () => {
  it('returns the root identifier of a property access', () => {
    expect(variablesInExpression('${order.customer.name}')).toEqual(['order']);
  });

  it('finds every variable in a condition', () => {
    expect(variablesInExpression('${amount > limit && !approved}')).toEqual(['amount', 'limit', 'approved']);
  });

  it('skips operator words, literals and function names', () => {
    expect(variablesInExpression("${empty items or status eq 'done' and fn:upper(name) == 'X'}")).toEqual(['items', 'status', 'name']);
  });

  it('reads deferred expressions and ignores plain text', () => {
    expect(variablesInExpression('Hello #{customer}, plain text')).toEqual(['customer']);
    expect(variablesInExpression('no expression')).toEqual([]);
  });
});
