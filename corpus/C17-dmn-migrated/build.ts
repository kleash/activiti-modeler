import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C17 migrated DMN (feature DM9), through the real modeler. The input is the legacy file of the negative corpus,
 * `corpus/N01-negative/models/legacy-discount.dmn`: DMN 1.1, Camunda's default namespace, an output column without a name, `integer`
 * as a type. The build opens it the way the DMN editor opens a tab (`openDmn`: `@bpmn-io/dmn-migrate` turns it into DMN 1.3, dmn-js imports
 * it), and the export writes it the way a save does (`normalizeDmn`: the portable form, ADR 0004). The runner then compares that file with
 * `seed/processes/legacy-discount.dmn`, which is the migrated file as it was reviewed by hand, and the harness evaluates it on the engine:
 * `decisions[]` cases and a process with a decision task wired to the migrated decision (the picker). So the proof chain is
 * 1.1 file -> modeler migration -> portable 1.3 file -> Activiti 9.0.0 with the DMN connector (and the KIE cross-check).
 * The same chain runs for a DMN 1.2 file, `legacy/shipping-fee.dmn`, against `seed/processes/shipping-fee.dmn` and its `decisions[]` cases.
 */
const NAMESPACE = 'http://kleash.github.io/corpus/C17-migrated';
const CONNECTOR = 'dmn-connector.EXECUTE_TABLE';
// build files are loaded as CommonJS by the Playwright runner
const here = __dirname;

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C17-dmn-migrated', { defaultMappings: 'none' });

  // --- the migrated table -----------------------------------------------------------------------------------------------------------
  const legacy = readFileSync(join(here, '..', 'N01-negative', 'models', 'legacy-discount.dmn'), 'utf8');
  const opened = await api.openDmn('legacy-discount', legacy);
  if (opened.migratedFrom !== '1.1') throw new Error(`legacy-discount.dmn should have been migrated from DMN 1.1, got ${JSON.stringify(opened)}`);
  if (opened.warnings.length > 0) throw new Error(`the migrated file opened with warnings: ${opened.warnings.join('; ')}`);

  // --- a DMN 1.2 file, as Camunda Modeler 4 writes it (the Camunda namespace and an attribute of it, `double`, empty entries, no input data)
  const dmn12 = readFileSync(join(here, 'legacy', 'shipping-fee.dmn'), 'utf8');
  const opened12 = await api.openDmn('shipping-fee', dmn12);
  if (opened12.migratedFrom !== '1.2') throw new Error(`shipping-fee.dmn should have been migrated from DMN 1.2, got ${JSON.stringify(opened12)}`);
  if (opened12.warnings.length > 0) throw new Error(`the migrated DMN 1.2 file opened with warnings: ${opened12.warnings.join('; ')}`);

  // --- a process with a decision task that evaluates it -----------------------------------------------------------------------------
  await api.newProcess('discountOrder', 'Discount for an order', { file: 'discount-order' });
  await api.setProperty('discountOrder', 'general.targetNamespace', NAMESPACE);
  await api.setProperty('discountOrder', 'documentation.text',
    'A decision task evaluates the migrated decision "discount" (a DMN 1.1 file that the modeler migrated to 1.3) and the exclusive gateway routes on whether a rule matched: gold customers get 10, everybody else gets no discount (the table has no other rule, so no rule matches).');
  await api.createShape({ type: 'startEvent', id: 'start', name: 'Order received', at: at(0, 1) });
  await api.createShape({ type: 'serviceTask', id: 'decideDiscount', name: 'Decide the discount', attrs: { implementation: CONNECTOR }, at: at(1, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'discountGateway', name: 'Discount?', at: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'discountedEnd', name: 'Discounted', at: at(3, 0) });
  await api.createShape({ type: 'endEvent', id: 'noDiscountEnd', name: 'No discount', at: at(3, 2) });
  await chain(api, 'start', 'decideDiscount', 'discountGateway');
  await api.connect('discountGateway', 'discountedEnd', 'f_discountGateway_discountedEnd', { name: 'matched' });
  await api.setProperty('f_discountGateway_discountedEnd', 'flow.condition', '${matched}');
  await api.connect('discountGateway', 'noDiscountEnd', 'f_discountGateway_noDiscountEnd', { name: 'no rule matched' });
  await api.setProperty('f_discountGateway_noDiscountEnd', 'flow.default', true);
  await api.setExtensions({ properties: [{ name: 'customer', type: 'string' }, { name: 'matched', type: 'boolean' }] });
  // the picker wires the decision by its id: a VARIABLE input for the input it reads, a VARIABLE output for its output column
  await api.setProperty('decideDiscount', 'decision.pick', { decision: 'discount', matched: 'matched', matchedRules: 'matchedRules' });
}
