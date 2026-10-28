import type { ModdleElement } from 'bpmn-moddle';
import type { ExtensionsFile } from '@activiti-modeler/activiti-project';

export type { ModdleElement };
/** A bpmn-moddle element. The rules read it through the helpers of model.ts. */
export type ME = ModdleElement;

/** Severity of a problem as the Problems panel shows it. bpmnlint says `warn`, the panel `warning`. */
export type Severity = 'error' | 'warning' | 'info';
export type RuleCategory = 'error' | 'warn' | 'info';

export const categoryToSeverity = (category: string): Severity => (category === 'error' ? 'error' : category === 'warn' ? 'warning' : 'info');
export const severityToCategory = (severity: Severity): RuleCategory => (severity === 'error' ? 'error' : severity === 'warning' ? 'warn' : 'info');

/** A connector definition of the project (`connectors/<name>.json`, descriptors of the Activiti 7 connector beans). */
export interface ConnectorAction {
  id: string;
  name?: string;
  inputs: Array<{ id: string; name: string; type?: string; required?: boolean }>;
  outputs: Array<{ id: string; name: string; type?: string }>;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  /** Version of the connector definition, compared with the version an element's template link recorded (L36). */
  version?: string;
  actions: Record<string, ConnectorAction>;
}

/** A decision of a DMN file, as far as the lint rules need it (L23, L37). */
export interface DecisionInfo {
  /** The decision id: what the decision task's `_activiti_dmn_table_` constant holds. */
  id: string;
  name?: string;
  /** Names of the variables the decision's own table reads: input expressions that are plain names. */
  inputs: string[];
  /** Input expressions that are not a plain name (they cannot be matched to a mapping by name). */
  complexInputs: string[];
  /** Ids of the decisions it requires (DRD). */
  requiredDecisions: string[];
  /** Names of the input data it requires. */
  requiredInputs: string[];
  /** Output columns of its decision table (`name` is missing when the column has none; `type` is the FEEL `typeRef`). */
  outputs: Array<{ id?: string; name?: string; type?: string }>;
  /** `hitPolicy` of its decision table (`UNIQUE` when the file leaves it out) and the COLLECT `aggregation`, when there is a table. */
  hitPolicy?: string;
  aggregation?: string;
}

/** What the lint rules know about a DMN file. */
export interface DmnFileInfo {
  path: string;
  /** File name without directory and `.dmn`. */
  baseName: string;
  /** `definitions/@name`. */
  name?: string;
  /** DMN version read from the namespace; undefined when it is not a DMN namespace. */
  version?: '1.1' | '1.2' | '1.3' | '1.4' | '1.5';
  decisions: DecisionInfo[];
  /** `inputData` elements: id -> variable name. */
  inputData: Record<string, string>;
  /** Elements only the KIE engine can evaluate (BKM, boxed expressions other than table and literal, decision services). */
  kieOnly: Array<{ element: string; id?: string; decision?: string }>;
}

/** What a process document knows about the other files of its project (cross-document rules: L8, L17, L23, L24, L25, L34, L37). */
export interface ProjectIndex {
  /** Every executable or not process of the project's BPMN files, including the document being linted. */
  processes: Array<{ path: string; id: string; name?: string; executable: boolean; messageStarts: string[] }>;
  /** Present when the project's `connectors/` folder is known. */
  connectors?: ConnectorDefinition[];
  /** Present when the project's DMN files are known. */
  dmn?: DmnFileInfo[];
  /** Message names caught elsewhere in the project, for L30: `{ path, processId, message, elementId, hasCorrelationKey }`. */
  messageCatches?: Array<{ path: string; processId: string; message: string; elementId: string; hasCorrelationKey: boolean; kind: 'start' | 'catch' | 'boundary' | 'eventSubProcess' }>;
  /** Called processes' extension files: a called process without an extensions entry swallows mapped inputs (engine finding C11.2). */
  extensions?: Record<string, ExtensionsFile>;
}

/** Context of a lint run: the facts a rule needs that are not in the BPMN document itself. Everything is optional; a rule whose input is missing says nothing. */
export interface LintContext {
  /** Project path of the document being linted. */
  path?: string;
  /** The `-extensions.json` of this document. */
  extensions?: ExtensionsFile;
  /** `fromXML` warnings about references that did not resolve: element -> property -> the id as written. */
  unresolved?: Map<object, Record<string, string>>;
  /** Elements bpmn-moddle dropped when it read the file because their id was already taken (`duplicate ID` warnings). */
  duplicateIds?: Array<{ id: string; tag: string }>;
  project?: ProjectIndex;
  /** false when the engine's async executor is known to be off (the engine then warns about async flags and timers). */
  asyncExecutorActive?: boolean;
  /** Script formats with a JSR-223 engine in the host application, besides juel and javascript. */
  scriptEngines?: string[];
  /** Raw text of the document, for the few rules that look at the file as written (the XSD child order, minified multi-instance). */
  text?: string;
}

/** A finding, normalised for the Problems panel, the overlays, the CLI and the server merge. */
export interface Problem {
  /** Stable within one lint run: `<path>|<rule>|<elementId>|<n>`. */
  id: string;
  /** Project path of the file; empty for a single document linted without a path. */
  path: string;
  /** The diagram element to select; undefined for a finding about the whole file. */
  elementId?: string;
  /** `activiti/<rule>`, `bpmnlint/<rule>` or `engine/<key>`. */
  rule: string;
  /** The ProcessValidator problem key (`SERVICE_TASK_MISSING_IMPLEMENTATION`) the rule mirrors, or the server's key for an engine problem. */
  key?: string;
  severity: Severity;
  message: string;
  source: 'client' | 'engine';
  /** Property accessor key of the properties-panel entry to focus (`impl.class`, `script.text`, ...). */
  entryId?: string;
  /** Quick fix offered for this problem. */
  fix?: { id: string; label: string };
  /** Page of the rule in the user guide. */
  documentationUrl?: string;
  /** Rule specific details a quick fix needs (e.g. the Camunda attribute name). */
  data?: Record<string, unknown>;
  line?: number;
  column?: number;
}

export interface Fixture {
  /** Elements of the process `p` (default namespace is BPMN; `activiti:`, `camunda:`, `xsi:`, `xsd:` are declared). */
  body?: string;
  /** Attributes of the `<process>` element; replaces the default `isExecutable="true"`. */
  process?: string;
  /** Extra attributes of the `<definitions>` element. */
  defs?: string;
  /** Elements of `<definitions>` before the process (messages, signals, errors, item definitions). */
  head?: string;
  /** Elements of `<definitions>` after the process (second process, collaboration). */
  tail?: string;
  /** Complete document; overrides body/head/tail. */
  xml?: string;
  /** Extensions JSON for the process `p` (the `extensions.p` object) or the whole file when it has an `extensions` key. */
  ext?: Record<string, unknown>;
  context?: Partial<LintContext>;
  /** Other files of the project, for the cross-document rules. */
  files?: Record<string, string>;
  /** Expected ids of the reports (bad fixtures); sorted comparison. */
  ids?: string[];
  /** Why this fixture exists, shown in the rule page. */
  note?: string;
}
