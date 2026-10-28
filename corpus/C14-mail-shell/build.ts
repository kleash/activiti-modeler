import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C14 mail and shell, modelled through the real modeler (window.__modelerTestApi: the property accessors and
 * diagram-js commands the properties panel uses) and exported with the real export pipeline. It reproduces
 * `seed/processes/*`; the runner compares the result with the seed semantically and the harness runs the hand-written
 * scenarios of this folder against it (harness.properties starts the GreenMail server).
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C14';

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

type FieldValue = string | { expression: string };
/** Literal text is an `activiti:string`, `{ expression }` an `activiti:expression`. */
const x = (expression: string): FieldValue => ({ expression });

/** A mail or shell task, filled in field by field through the structured editors' accessors (`mail.*`, `shell.*`). */
async function typedTask(api: ModelerApi, type: 'serviceTask' | 'sendTask', kind: 'mail' | 'shell', id: string, name: string, position: { x: number; y: number }, fields: Array<[string, FieldValue]>): Promise<void> {
  await api.createShape({ type, id, name, at: position });
  await api.setProperty(id, 'impl.type', kind);
  for (const [field, value] of fields) await api.setProperty(id, `${kind}.${field}`, value);
}

async function expressionTask(api: ModelerApi, id: string, name: string, expression: string, position: { x: number; y: number }, resultVariable?: string): Promise<void> {
  await api.createShape({ type: 'serviceTask', id, name, at: position });
  await api.setProperty(id, 'impl.type', 'expression');
  await api.setProperty(id, 'impl.expression', expression);
  if (resultVariable) await api.setProperty(id, 'impl.resultVariable', resultVariable);
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C14-mail-shell', { defaultMappings: 'none' });

  // --- mail-errors --------------------------------------------------------------------------------------------------------
  await newProcess(api, 'mail-errors', 'mailErrors', 'Mail errors and ignoreException',
    'A mail task whose recipient comes from the process variable recipient. With ignoreException true a failure (an invalid recipient here) is swallowed, its message is stored in the variable named by exceptionVariableName and the process goes on; with ignoreException false the exception fails the call.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await typedTask(api, 'serviceTask', 'mail', 'sendStrict', 'Send a mail', at(1, 1), [
    ['to', x('${recipient}')],
    ['from', 'shop@corpus.test'],
    ['subject', 'Strict mail'],
    ['text', 'Mail that may fail.'],
    ['ignoreException', x('${ignore}')],
    ['exceptionVariableName', 'mailError'],
  ]);
  await expressionTask(api, 'afterMail', 'Continue', "${execution.setVariable('continued', true)}", at(2, 1));
  await expressionTask(api, 'captureRecipient', "Capture the recipient's inbox", '${mailbox.inbox(recipient)}', at(3, 1), 'recipientInbox');
  await api.createShape({ type: 'endEvent', id: 'end', at: at(4, 1) });
  await chain(api, 'start', 'sendStrict', 'afterMail', 'captureRecipient', 'end');

  // --- mail-tasks ---------------------------------------------------------------------------------------------------------
  await newProcess(api, 'mail-tasks', 'mailTasks', 'Mail tasks and send tasks',
    "Mail through the corpus mail server (GreenMail, started because harness.properties say so): a plain mail with cc and bcc, an html mail with a plain alternative and a charset, a mail whose texts come from process variables (textVar and htmlVar name the variables, whose content is evaluated at send time), a mail with an attachment, and a send task (activiti:type=\"mail\" on a sendTask). Tasks without a from field use the engine's default from address. The capture tasks copy the inboxes into variables so that the scenario can assert what was delivered.");
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await expressionTask(api, 'prepareText', 'Prepare the text template', "${execution.setVariable('mailText', mailTemplates.text())}", at(1, 1));
  await expressionTask(api, 'prepareHtml', 'Prepare the html template', "${execution.setVariable('mailHtml', mailTemplates.html())}", at(2, 1));
  await typedTask(api, 'serviceTask', 'mail', 'sendPlain', 'Send a plain mail', at(3, 1), [
    ['to', x('${customerEmail}')],
    ['from', 'shop@corpus.test'],
    ['cc', x('${auditEmail}')],
    ['bcc', x('${archiveEmail}')],
    ['subject', x('Order ${orderId} confirmed')],
    ['text', x('Dear ${customerName}, thank you.')],
  ]);
  await typedTask(api, 'serviceTask', 'mail', 'sendHtml', 'Send an html mail', at(4, 1), [
    ['to', x('${customerEmail}')],
    ['subject', x('Grüße for order ${orderId}')],
    ['html', x('<p>Hi <b>${customerName}</b></p>')],
    ['text', x('Hi ${customerName} (plain alternative)')],
    ['charset', 'UTF-8'],
  ]);
  await typedTask(api, 'serviceTask', 'mail', 'sendFromVariables', 'Send a mail from variables', at(5, 1), [
    ['to', x('${customerEmail}')],
    ['subject', x('Template for order ${orderId}')],
    ['textVar', 'mailText'],
    ['htmlVar', 'mailHtml'],
  ]);
  await typedTask(api, 'serviceTask', 'mail', 'sendWithAttachment', 'Send a mail with an attachment', at(6, 1), [
    ['to', x('${customerEmail}')],
    ['subject', x('Report for order ${orderId}')],
    ['text', 'Report attached.'],
    ['attachments', x('${mailAttachments.report()}')],
  ]);
  await typedTask(api, 'sendTask', 'mail', 'notifyBySendTask', 'Notify with a send task', at(7, 1), [
    ['to', x('${customerEmail}')],
    ['subject', x('Shipped ${orderId}')],
    ['text', x('Your order ${orderId} has shipped.')],
  ]);
  await expressionTask(api, 'captureCustomer', "Capture the customer's inbox", '${mailbox.inbox(customerEmail)}', at(8, 1), 'customerInbox');
  await expressionTask(api, 'captureAudit', 'Capture the cc inbox', '${mailbox.inbox(auditEmail)}', at(9, 1), 'auditInbox');
  await expressionTask(api, 'captureArchive', 'Capture the bcc inbox', '${mailbox.inbox(archiveEmail)}', at(10, 1), 'archiveInbox');
  await api.createShape({ type: 'endEvent', id: 'end', at: at(11, 1) });
  await chain(api, 'start', 'prepareText', 'prepareHtml', 'sendPlain', 'sendHtml', 'sendFromVariables', 'sendWithAttachment', 'notifyBySendTask', 'captureCustomer', 'captureAudit', 'captureArchive', 'end');

  // --- shell-tasks --------------------------------------------------------------------------------------------------------
  await newProcess(api, 'shell-tasks', 'shellTasks', 'Shell tasks',
    'Shell tasks (activiti:type="shell") with every field: command, arg1 to arg5, outputVariable (standard output), errorCodeVariable (the exit code as text; a non-zero code does not fail the task), redirectError, directory, cleanEnv and wait. The commands exist on Linux and macOS.');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  const shells: Array<[string, string, Array<[string, FieldValue]>]> = [
    ['echoArgs', 'Echo five arguments', [['command', 'echo'], ['arg1', 'a'], ['arg2', 'b'], ['arg3', 'c'], ['arg4', 'd'], ['arg5', x('${who}')], ['outputVariable', 'echoOut'], ['errorCodeVariable', 'echoCode']]],
    ['exitThree', 'Exit with code 3', [['command', 'sh'], ['arg1', '-c'], ['arg2', 'exit 3'], ['errorCodeVariable', 'exitCode']]],
    ['streamsRedirected', 'Standard error redirected', [['command', 'sh'], ['arg1', '-c'], ['arg2', 'echo out; echo err 1>&2'], ['redirectError', 'true'], ['outputVariable', 'mergedOut']]],
    ['streamsSeparate', 'Standard error not redirected', [['command', 'sh'], ['arg1', '-c'], ['arg2', 'echo out; echo err 1>&2'], ['redirectError', 'false'], ['outputVariable', 'stdoutOnly']]],
    ['inDirectory', 'Run in a directory', [['command', 'pwd'], ['directory', '/'], ['outputVariable', 'cwd']]],
    ['cleanEnvironment', 'Run with a clean environment', [['command', '/usr/bin/env'], ['cleanEnv', 'true'], ['outputVariable', 'envClean']]],
    ['fullEnvironment', 'Run with the inherited environment', [['command', '/usr/bin/env'], ['outputVariable', 'envFull']]],
    ['noWait', 'Do not wait', [['command', 'echo'], ['arg1', 'ignored'], ['wait', 'false'], ['outputVariable', 'noWaitOut'], ['errorCodeVariable', 'noWaitCode']]],
  ];
  for (const [i, [id, name, fields]] of shells.entries()) await typedTask(api, 'serviceTask', 'shell', id, name, at(i + 1, 1), fields);
  await api.createShape({ type: 'endEvent', id: 'end', at: at(shells.length + 1, 1) });
  await chain(api, 'start', ...shells.map(([id]) => id), 'end');
}
