import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C03 script tasks, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`;
 * the runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this
 * folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C03';

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

interface ScriptSpec {
  id: string;
  name: string;
  format?: string;
  script: string;
  resultVariable?: string;
  autoStore?: boolean;
}

/** start -> scripts... -> (end, when `end` is not false) on one row. */
async function scripts(api: ModelerApi, specs: ScriptSpec[], end = true): Promise<void> {
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  for (const [i, s] of specs.entries()) {
    await api.createShape({ type: 'scriptTask', id: s.id, name: s.name, at: at(i + 1, 1) });
    if (s.format) await api.setProperty(s.id, 'script.format', s.format);
    await api.setProperty(s.id, 'script.text', s.script);
    if (s.resultVariable) await api.setProperty(s.id, 'script.resultVariable', s.resultVariable);
    if (s.autoStore) await api.setProperty(s.id, 'script.autoStoreVariables', true);
  }
  if (end) {
    await api.createShape({ type: 'endEvent', id: 'end', at: at(specs.length + 1, 1) });
    await chain(api, 'start', ...specs.map((s) => s.id), 'end');
  }
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C03-script-tasks', { defaultMappings: 'none' });

  // --- auto-store ---------------------------------------------------------------------------------------------------------
  await newProcess(api, 'auto-store', 'autoStore', 'Script variables', 'activiti:autoStoreVariables decides whether variables a script assigns become process variables.');
  await scripts(api, [
    { id: 'assignPlain', name: 'Assign without auto store', format: 'javascript', script: 'plainGlobal = 1;\nvar plainLocal = 2;' },
    { id: 'assignStored', name: 'Assign with auto store', format: 'javascript', script: 'storedGlobal = 3;\nvar storedLocal = 4;', autoStore: true },
  ]);

  // --- javascript-scripts -------------------------------------------------------------------------------------------------
  await newProcess(api, 'javascript-scripts', 'javascriptScripts', 'JavaScript scripts',
    'JavaScript (Nashorn) script tasks under three engine names: variables are visible by name, execution.setVariable writes, the value of the last expression goes to the result variable.');
  await scripts(api, [
    {
      id: 'sumPrices',
      name: 'Sum the prices',
      format: 'javascript',
      resultVariable: 'itemCount',
      script: "var total = 0;\nfor (var i = 0; i < prices.size(); i++) {\n  total += prices.get(i);\n}\nexecution.setVariable('sum', total);\nprices.size();",
    },
    { id: 'scale', name: 'Scale the sum', format: 'js', resultVariable: 'scaled', script: 'sum * factor' },
    { id: 'summarize', name: 'Summarize', format: 'ECMAScript', resultVariable: 'summary', script: "'items=' + itemCount + ', scaled=' + scaled" },
  ]);

  // --- juel-scripts -------------------------------------------------------------------------------------------------------
  await newProcess(api, 'juel-scripts', 'juelScripts', 'JUEL scripts', 'Script tasks in the default script language (JUEL): the script is an expression, its value goes to the result variable.');
  await scripts(
    api,
    [
      { id: 'calcTotal', name: 'Calculate total', resultVariable: 'total', script: '${price * quantity}' },
      { id: 'applyDiscount', name: 'Apply discount', format: 'juel', resultVariable: 'net', script: '${total > 100 ? total * 0.9 : total}' },
      { id: 'greet', name: 'Greet customer', format: 'juel', resultVariable: 'greeting', script: '${greeter.greet(scriptHelper.upper(customer))}' },
      { id: 'flagLarge', name: 'Flag large orders', format: 'juel', script: "${execution.setVariable('large', net > 100)}" },
    ],
    false,
  );
  await api.createShape({ type: 'exclusiveGateway', id: 'sizeGate', name: 'Large?', at: at(5, 1) });
  await api.createShape({ type: 'endEvent', id: 'largeEnd', name: 'Large order', at: at(6, 0) });
  await api.createShape({ type: 'endEvent', id: 'smallEnd', name: 'Small order', at: at(6, 2) });
  await chain(api, 'start', 'calcTotal', 'applyDiscount', 'greet', 'flagLarge', 'sizeGate');
  await api.connect('sizeGate', 'largeEnd', 'f_sizeGate_largeEnd');
  await api.setProperty('f_sizeGate_largeEnd', 'flow.condition', '${large}');
  await api.connect('sizeGate', 'smallEnd', 'f_sizeGate_smallEnd');
  await api.setProperty('f_sizeGate_smallEnd', 'flow.default', true);

  // --- script-errors ------------------------------------------------------------------------------------------------------
  await newProcess(api, 'script-errors', 'scriptErrors', 'BpmnError thrown from scripts',
    'A BpmnError thrown by a JavaScript or a JUEL script is routed to the error boundary events of the script task; any other exception rolls the call back.');
  await api.setProperty('scriptErrors', 'definitions.errors', [{ id: 'scriptFailed', name: 'Script failed', errorCode: 'SCRIPT_FAILED' }]);
  await scripts(
    api,
    [
      {
        id: 'jsRisky',
        name: 'Risky JavaScript',
        format: 'javascript',
        resultVariable: 'jsOutcome',
        script:
          "var code = execution.getVariable('jsFailWith');\nif (code == 'PLAIN') {\n  throw 'a plain script failure';\n}\nif (code != null) {\n  var BpmnError = Java.type('org.activiti.engine.delegate.BpmnError');\n  throw new BpmnError(code, 'raised by the JavaScript');\n}\n'js ok'",
      },
      {
        id: 'juelRisky',
        name: 'Risky JUEL',
        format: 'juel',
        resultVariable: 'juelOutcome',
        script: "${empty execution.getVariable('juelFailWith') ? 'juel ok' : scriptHelper.fail(execution.getVariable('juelFailWith'))}",
      },
    ],
    false,
  );
  await api.createShape({ type: 'boundaryEvent', id: 'onJsError', name: 'Script failed', eventDefinition: 'error', attachedTo: 'jsRisky' });
  await api.setProperty('onJsError', 'error.ref', 'SCRIPT_FAILED');
  await api.createShape({ type: 'endEvent', id: 'jsHandledEnd', name: 'JavaScript error handled', at: at(1, 3) });
  await api.connect('onJsError', 'jsHandledEnd', 'f_onJsError_jsHandledEnd');
  await api.createShape({ type: 'boundaryEvent', id: 'onJuelError', name: 'Any error', eventDefinition: 'error', attachedTo: 'juelRisky' });
  await api.createShape({ type: 'endEvent', id: 'juelHandledEnd', name: 'JUEL error handled', at: at(2, 3) });
  await api.connect('onJuelError', 'juelHandledEnd', 'f_onJuelError_juelHandledEnd');
  await api.createShape({ type: 'endEvent', id: 'okEnd', name: 'No error', at: at(3, 1) });
  await chain(api, 'start', 'jsRisky', 'juelRisky', 'okEnd');
}
