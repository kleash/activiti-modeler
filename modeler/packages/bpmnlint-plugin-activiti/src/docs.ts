/** Generates the rule pages of docs/user-guide/lint-rules/ from the rule catalog, so a page cannot drift from the rule. */
import { RULES } from './catalog';
import { CORE_NOTES, CORE_TUNING } from './linter';
import { ENGINE_PROBLEM_KEYS } from './engine-keys';
import { fixLabel } from './fix-ids';
import type { RuleDef } from './define';
import type { Fixture } from './types';

const DOCS = '../../';

/** Rule ids by the numbered rules of FEATURE_MATRIX §D / R1 §7.1 (rules that other rules cover are listed with the covering rule). */
export const NUMBERED: Array<[string, string, string[]]> = [
  ['L1', 'camunda: / zeebe: attributes and elements', ['no-camunda-extensions']],
  ['L2', 'businessRuleTask', ['no-business-rule-task']],
  ['L3', 'serviceTask / sendTask type other than mail or shell', ['unsupported-service-task-type', 'service-task-invalid-type']],
  ['L4', 'complexGateway, adHocSubProcess', ['bpmnlint/no-complex-gateway', 'no-ad-hoc-sub-process']],
  ['L5', 'signal / timer start in an event sub process', ['no-signal-start-in-event-subprocess', 'event-subprocess-invalid-start-event-definition']],
  ['L6', 'signal / escalation / link / compensation end event, escalation throw', ['no-signal-end-event', 'no-unsupported-end-event', 'no-unsupported-event-definition']],
  ['L7', 'escalation / conditional event definitions', ['no-unsupported-event-definition', 'boundary-event-no-event-definition']],
  ['L8', 'connector not in the project', ['connector-bean-unknown']],
  ['L9', 'missing mapping', ['missing-mapping']],
  ['L10', 'extensions entry for an unknown process', ['extensions-unknown-process', 'extensions-unknown-element']],
  ['L11', 'invalid property type', ['property-type-invalid']],
  ['L12', 'cancel end without compensable work', ['cancel-end-without-compensation']],
  ['L13', 'send task without mail', ['send-task-invalid-implementation']],
  ['L14', 'script format without an engine', ['unsupported-script-format']],
  ['L15', 'process not executable; connector task without a name', ['all-process-definitions-not-executable', 'process-definition-not-executable', 'connector-task-missing-name']],
  ['L16', 'minified multi-instance XML', ['multi-instance-minified-xml']],
  ['L17', 'message start with the same name twice', ['message-start-name-not-unique']],
  ['L18', 'message throw without a delegate', ['message-throw-without-delegate']],
  ['L19', 'event-based gateway target', ['event-gateway-only-connected-to-intermediate-events']],
  ['L20', 'skipExpression without the enabling variable', ['skip-expression-needs-enable-variable']],
  ['L21', 'output target not declared', ['output-target-undeclared']],
  ['L22', 'mapping keyed to a missing element', ['extensions-unknown-element']],
  ['L23', 'decision task without a (known) decision', ['decision-task-unknown-decision']],
  ['L24', 'connector action missing; required input unmapped', ['connector-action-unknown', 'connector-required-input-unmapped']],
  ['L25', 'called element invalid or unknown', ['called-element-invalid', 'called-element-unknown']],
  ['L26', 'activiti:initiator', ['initiator-needs-authenticated-user']],
  ['L27', 'malformed JUEL', ['invalid-juel-expression', 'seq-flow-invalid-conditional-expression']],
  ['L28', 'invalid timer value', ['invalid-timer-value']],
  ['L29', 'DMN construct not supported by the DMN engine profile', ['dmn-unsupported-on-operaton']],
  ['L30', 'message subscription clash', ['message-subscription-clash']],
  ['L31', 'failedJobRetryTimeCycle on a non-service task', ['failed-job-retry-ignored']],
  ['L32', 'mapException where it is ignored', ['map-exception-ignored']],
  ['L33', 'DMN output without a name', ['dmn-output-without-name']],
  ['L34', 'process keys and message start names unique in the project', ['process-key-not-unique-in-project', 'message-start-name-not-unique']],
  ['L35', 'loopDataInputRef / loopDataOutputRef not a variable name', ['loop-data-ref-not-variable-name']],
  ['L36', 'outdated connector template', ['connector-template-outdated']],
  ['L37', 'decision input unmapped', ['decision-input-unmapped']],
];

const CORE_PAGES: Record<string, { title: string; text: string }> = {
  'no-complex-gateway': { title: 'A complex gateway', text: 'bpmnlint reports every complex gateway. Activiti has no complex gateway behaviour: `ComplexGatewayXMLConverter` builds an **exclusive gateway**, so the activation condition you modelled is ignored and the first true flow wins (R1 §0.1-4). The quick fix replaces the gateway by an exclusive gateway, which is what runs anyway.' },
  'ad-hoc-sub-process': { title: 'A start or end event inside an ad-hoc sub process', text: 'BPMN allows neither a start nor an end event inside an ad-hoc sub process. The sub process itself is reported by `no-ad-hoc-sub-process`, because Activiti waits in it forever (R1 §0.1-5).' },
  'event-sub-process-typed-start-event': { title: 'An event sub process whose start event has no type', text: 'An event sub process is started by its start event, so the start event must be an error or message event in Activiti. A none start event never fires; timer starts are rejected and signal starts do nothing (see `no-signal-start-in-event-subprocess`).' },
  'no-inclusive-gateway': { title: 'An inclusive gateway (switched off)', text: 'bpmnlint discourages inclusive gateways. Activiti executes them (`default` flow, join waits for the active branches), so the rule is switched off in `activiti:recommended`.' },
};

const link = (evidence: string): string => {
  const r1 = /^R1 §([\d.]+)(?:-(\d+))?/.exec(evidence);
  if (r1) return `[${evidence}](${DOCS}research/activiti-9-bpmn-support.md)`;
  if (/^engine-findings|^engine run/.test(evidence)) return `[${evidence}](${DOCS}engine-findings.md)`;
  const adr = /^ADR (\d{4})/.exec(evidence);
  if (adr) return `[${evidence}](${DOCS}adr/)`;
  if (/^FEATURE_MATRIX/.test(evidence)) return `[${evidence}](${DOCS}FEATURE_MATRIX.md)`;
  if (/dmn-conventions/.test(evidence)) return `[${evidence}](../dmn-conventions.md)`;
  return evidence;
};

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const sev = (s: string): string => (s === 'warn' ? 'warning' : s);

function example(f: Fixture): string {
  if (f.files && !f.body && !f.xml) {
    return Object.entries(f.files)
      .map(([path, content]) => `<!-- ${path} -->\n${content}`)
      .join('\n\n');
  }
  const parts: string[] = [];
  if (f.head) parts.push(`<!-- definitions -->\n${f.head}`);
  if (f.body !== undefined || f.xml === undefined) parts.push(`<!-- process -->\n${f.body ?? ''}`);
  const xml = f.xml ?? '';
  if (f.xml) parts.push(xml);
  if (f.ext) parts.push(`<!-- extensions -->\n${JSON.stringify(f.ext, null, 2)}`);
  if (f.tail) parts.push(`<!-- also in the file -->\n${f.tail}`);
  return parts.join('\n\n');
}

export function rulePage(rule: RuleDef): string {
  const lines: string[] = [];
  lines.push(`# ${rule.id}`, '', `**${rule.title}**`, '');
  lines.push('| | |', '|---|---|');
  lines.push(`| Rule | \`activiti/${rule.id}\` |`);
  lines.push(`| Severity | ${sev(rule.severity)} |`);
  if (rule.key) lines.push(`| Engine problem key | \`${rule.key}\` (mirrors \`ProcessValidator\`) |`);
  lines.push(`| Kind | ${kindName(rule)} |`);
  if (rule.quickFix) lines.push(`| Quick fix | ${fixLabel(rule.quickFix)} |`);
  if (rule.needs?.length) lines.push(`| Reads | ${rule.needs.map((n) => ({ extensions: 'the extensions JSON of the process', project: 'the other files of the project', text: 'the file as written', server: 'the engine (server validation)' })[n]).join(', ')} |`);
  lines.push('', '## Why it matters', '', rule.why, '', `Evidence: ${rule.evidence.map(link).join(', ')}.`, '');
  lines.push('## How to fix', '', rule.howToFix, '');
  const bad = rule.bad[0];
  const good = rule.good[0];
  if (bad) lines.push('## Example', '', 'Reported:', '', '```xml', example(bad), '```', '');
  if (good) lines.push('Accepted:', '', '```xml', example(good), '```', '');
  lines.push('[All lint rules](index.md)', '');
  return lines.join('\n');
}

function kindName(rule: RuleDef): string {
  if (rule.tag === 'V') return 'Engine validator mirror';
  if (rule.tag === 'C') return 'Construct Activiti 9 does not execute (FEATURE_MATRIX §C)';
  if (rule.tag === 'X') return 'Engine behaviour the validator does not catch';
  return `Extra rule ${rule.tag} (FEATURE_MATRIX §D)`;
}

export function corePage(name: string): string {
  const page = CORE_PAGES[name]!;
  const level = CORE_TUNING[name];
  return [
    `# bpmnlint/${name}`,
    '',
    `**${page.title}**`,
    '',
    '| | |',
    '|---|---|',
    `| Rule | \`${name}\` of [bpmnlint](https://github.com/bpmn-io/bpmnlint) |`,
    `| Severity in \`activiti:recommended\` | ${level === 'off' ? 'off' : sev(level ?? 'error')} |`,
    '',
    '## What it means for Activiti',
    '',
    page.text,
    '',
    CORE_NOTES[name] ? `Message note: ${CORE_NOTES[name]}.` : '',
    '',
    '[All lint rules](index.md)',
    '',
  ].join('\n');
}

export const CORE_PAGE_NAMES = Object.keys(CORE_PAGES);

export function indexPage(): string {
  const byTag = (pred: (r: RuleDef) => boolean): RuleDef[] => RULES.filter(pred);
  const row = (r: RuleDef): string => `| [${r.id}](${r.id}.md) | ${sev(r.severity)} | ${cell(r.title)} |`;
  const table = (rules: RuleDef[]): string[] => ['| Rule | Severity | What |', '|---|---|---|', ...rules.map(row), ''];
  const counts = { error: 0, warn: 0, info: 0 };
  for (const r of RULES) counts[r.severity] += 1;
  const lines: string[] = [
    '# Lint rules',
    '',
    `The modeler lints every process while you edit it, and the whole project before it is deployed. The rules come from three places:`,
    '',
    `1. **${ENGINE_PROBLEM_KEYS.length} mirrors of the Activiti validator** (\`ProcessValidator\`): one rule per problem key, with the engine's severity and its key in the message. They find what the engine rejects when the process is deployed, while you edit.`,
    '2. **Rules for what the engine does not catch**: constructs Activiti does not execute, Camunda leftovers, mappings that are silently inert, and the traps found while testing the engine (numbered L1 to L37 in the feature matrix, plus the engine-behaviour rules).',
    '3. **bpmnlint `recommended`**, tuned (see below).',
    '',
    `In total ${RULES.length} Activiti rules (${counts.error} errors, ${counts.warn} warnings, ${counts.info} notes by default). The **Problems** panel shows them with the element, a link to the page of the rule and, where one exists, a quick fix. When a modeler server is connected its own validation (\`/api/dev/validate\`, tagged *engine*) is merged in. Errors block a deployment from the modeler.`,
    '',
    'Configure a rule by name in the `rules` of a bpmnlint config: `"activiti/missing-mapping": "off"`. Use the config `plugin:activiti/recommended` (all rules at the default severity) or `plugin:activiti/all`.',
    '',
    '## Tuning of bpmnlint `recommended`',
    '',
    '| bpmnlint rule | In `activiti:recommended` | Why |',
    '|---|---|---|',
    ...Object.entries(CORE_TUNING).map(([name, level]) => `| ${CORE_PAGES[name] ? `[${name}](bpmnlint-${name}.md)` : name} | ${level === 'off' ? 'off' : sev(level)} | ${tuningReason(name)} |`),
    '',
    'Every other bpmnlint recommended rule keeps its bpmnlint severity.',
    '',
    '## The numbered rules',
    '',
    'FEATURE_MATRIX §D and R1 §7.1 number the rules that the engine does not check. A number may be covered by more than one rule.',
    '',
    '| # | What | Rule |',
    '|---|---|---|',
    ...NUMBERED.map(([n, what, ids]) => `| ${n} | ${cell(what)} | ${ids.map((id) => (id.startsWith('bpmnlint/') ? `[${id}](bpmnlint-${id.slice(9)}.md)` : `[${id}](${id}.md)`)).join(', ')} |`),
    '',
    '## Mirrors of the engine validator',
    '',
    ...table(byTag((r) => r.tag === 'V')),
    '## Constructs Activiti 9 does not execute',
    '',
    'These are hidden from the palette and menus; an imported model that has one is reported (FEATURE_MATRIX §C).',
    '',
    ...table(byTag((r) => r.tag === 'C')),
    '## Camunda and foreign content',
    '',
    ...table(byTag((r) => ['no-camunda-extensions', 'foreign-attribute-namespace', 'unqualified-activiti-attribute', 'undeclared-qname-prefix', 'duplicate-element-id'].includes(r.id))),
    '## Mappings, connectors, decisions and the project',
    '',
    ...table(byTag((r) => r.needs?.some((n) => n === 'extensions' || n === 'project') === true && r.tag !== 'V')),
    '## Expressions and timers',
    '',
    ...table(byTag((r) => ['invalid-juel-expression', 'juel-string-concatenation', 'invalid-timer-value', 'timer-end-date-before-start'].includes(r.id))),
    '## Other rules',
    '',
    ...table(
      byTag(
        (r) =>
          r.tag !== 'V' &&
          r.tag !== 'C' &&
          !['no-camunda-extensions', 'foreign-attribute-namespace', 'unqualified-activiti-attribute', 'undeclared-qname-prefix', 'duplicate-element-id', 'invalid-juel-expression', 'juel-string-concatenation', 'invalid-timer-value', 'timer-end-date-before-start'].includes(r.id) &&
          !(r.needs?.some((n) => n === 'extensions' || n === 'project') === true),
      ),
    ),
    '## Engine problem keys',
    '',
    'Every key of `org.activiti.validation.validator.Problems` (Activiti 9.0.0) and the rule that mirrors it.',
    '',
    '| Key | Rule |',
    '|---|---|',
    ...ENGINE_PROBLEM_KEYS.map((key) => `| \`${key}\` | ${RULES.filter((r) => r.key === key).map((r) => `[${r.id}](${r.id}.md)`).join(', ')} |`),
    '',
    '## Where the problems appear',
    '',
    'See [Problems panel](../modeler-basics.md#problems-panel) for the panel, the status bar counters and the canvas markers, and the [developer guide](../../developer-guide.md#lint-and-the-problems-panel) for `lintProject()` and the focus event.',
    '',
    '## Command line',
    '',
    'The same rules run outside the browser, for CI and the corpus checks:',
    '',
    '```',
    'activiti-lint <project-folder>...     # processes/, connectors/ and the DMN files of a project',
    'activiti-lint <corpus> --seeds        # the seed folder of every project below a corpus folder',
    '```',
    '',
    'Options: `--json`, `--quiet` (errors only), `--max-warnings <n>`, `--ignore <rule>` (repeatable), `--kie` (lint DMN for the KIE engine), `--async-off` (the engine runs without an async executor), `--script-engine <name>` (a JSR-223 engine the application provides), `--list-rules`. The exit status is 1 when a project has an error (or more warnings than `--max-warnings`), 2 for a wrong command line. In the repository: `npm run lint:corpus -w @activiti-modeler/bpmnlint-plugin-activiti`.',
    '',
  ];
  return lines.join('\n');
}

function tuningReason(name: string): string {
  const reasons: Record<string, string> = {
    'no-inclusive-gateway': 'Activiti executes inclusive gateways.',
    'no-complex-gateway': 'Activiti runs it as an exclusive gateway.',
    'ad-hoc-sub-process': 'BPMN rule; the ad-hoc sub process itself is reported by activiti/no-ad-hoc-sub-process.',
    'event-sub-process-typed-start-event': 'An untyped start never fires.',
    'label-required': 'Style only; an error would block the deployment of an unlabeled start event.',
    'end-event-required': 'Activiti ends an execution that has no outgoing flow.',
    'no-implicit-end': 'Same.',
    'no-implicit-start': 'Style only.',
    'no-implicit-split': 'Conditional flows from tasks are supported (feature F3).',
    'no-gateway-join-fork': 'Style only.',
    'no-duplicate-sequence-flows': 'Runs as drawn (two tokens).',
    'conditional-flows': 'Activiti reports it as a warning too (`EXCLUSIVE_GATEWAY_SEQ_FLOW_WITHOUT_CONDITIONS`).',
    'no-disconnected': 'An unfinished diagram runs fine, and a new process is a lone start event.',
    'single-blank-start-event': 'Covered by `START_EVENT_MULTIPLE_FOUND` with the engine\'s key.',
  };
  return reasons[name] ?? '';
}
