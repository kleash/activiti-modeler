// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { processVariablesFor } from './projectVariables';

const DMN = `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="Risk model" namespace="urn:d">
  <decision id="riskLevel" name="riskLevel"><variable id="v" name="riskLevel"/><literalExpression id="l"><text>1</text></literalExpression></decision>
</definitions>`;
const ext = (constants: Record<string, unknown>, properties: Record<string, unknown>): string =>
  JSON.stringify({ id: 'process-p', extensions: { p: { properties, mappings: {}, constants } } });

describe('processVariablesFor', () => {
  it('suggests the declared variables of the processes whose decision tasks name a decision of the file', () => {
    const files = [
      { path: 'processes/risk.dmn', content: DMN },
      { path: 'processes/a-extensions.json', content: ext({ t: { _activiti_dmn_table_: { value: 'riskLevel' } } }, { x: { id: 'x', name: 'amount', type: 'integer' }, y: { id: 'y', name: 'country', type: 'string' } }) },
      { path: 'processes/b-extensions.json', content: ext({ t: { _activiti_dmn_table_: { value: 'risk' } } }, { z: { id: 'z', name: 'age', type: 'integer' } }) },
      { path: 'processes/c-extensions.json', content: ext({ t: { _activiti_dmn_table_: { value: 'somethingElse' } } }, { w: { id: 'w', name: 'unrelated', type: 'string' } }) },
      { path: 'processes/d-extensions.json', content: '{ not json' },
    ];
    expect(processVariablesFor('processes/risk.dmn', files)).toEqual([
      { name: 'amount', detail: 'integer', info: 'Process variable of p' },
      { name: 'country', detail: 'string', info: 'Process variable of p' },
      { name: 'age', detail: 'integer', info: 'Process variable of p' },
    ]);
  });

  it('suggests nothing for a file nobody calls or that is not in the project', () => {
    expect(processVariablesFor('processes/risk.dmn', [{ path: 'processes/risk.dmn', content: DMN }])).toEqual([]);
    expect(processVariablesFor('processes/missing.dmn', [])).toEqual([]);
  });
});
