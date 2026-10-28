import type { ExtensionsFile } from '../../extensions';

/**
 * Camunda 7 to Activiti 9 conversion (feature U17, docs/research/activiti-9-bpmn-support.md §5). Pure functions over the XML text:
 * `detectCamunda` says whether a file needs it, `convertCamundaBpmn` returns the converted BPMN, the extensions file that holds
 * what became input / output mappings, and the report of everything that could not be carried over.
 */

/** What a file contains of the vendor namespaces. */
export interface CamundaDetection {
  /** The file uses Camunda 7 attributes or elements: a conversion is offered. */
  found: boolean;
  /** Camunda 8 (Zeebe) extensions: nothing of them can be carried over. */
  zeebe: boolean;
  /** Prefixes bound to the Camunda 7 namespace (normally `camunda`). */
  prefixes: string[];
  /** Number of attributes and elements in the Camunda 7 namespace. */
  attributes: number;
  elements: number;
  /** Camunda Modeler metadata (`modeler:executionPlatform`, ...). */
  modeler: boolean;
  /** The text is not well-formed XML. */
  error?: string;
}

/** How a line of the report came about. */
export type ReportKind =
  /** Nothing of it exists in Activiti; the behaviour is gone. */
  | 'dropped'
  /** Translated, but Activiti does not behave exactly like Camunda. */
  | 'approximated'
  /** Metadata without behaviour (modeler attributes, element template markers). */
  | 'info';

export interface ReportEntry {
  kind: ReportKind;
  elementId: string;
  elementName?: string;
  /** `bpmn:userTask`. */
  elementType: string;
  /** What was in the file, as written there: `camunda:asyncAfter="true"`. */
  item: string;
  /** What happened to it. */
  what: string;
  /** Why Activiti cannot do better. */
  why: string;
}

/** A translation that was made, for the summary and the Markdown report. */
export interface ConvertedEntry {
  elementId: string;
  elementType: string;
  from: string;
  to: string;
}

export interface LossReport {
  /** Name of the file that was converted. */
  source: string;
  /** Remarks about the file as a whole (a Camunda 8 model, ...). */
  general: string[];
  entries: ReportEntry[];
  converted: ConvertedEntry[];
  counts: { converted: number; dropped: number; approximated: number; info: number };
}

/** What the converter may ask about the project: the DMN decision a business rule task names. */
export interface DecisionInfo {
  id: string;
  name?: string;
  inputs: string[];
  outputs: Array<{ name?: string; type?: string }>;
}

export interface ConvertOptions {
  /** Name of the file (for the report and the id of the extensions file): `order.bpmn`. */
  fileName?: string;
  /** The extensions file that already exists for this process file; the converted entries are added to it. */
  extensions?: ExtensionsFile;
  /**
   * `mapAll` (the default, as for a new element, ADR 0006): user tasks and message catch events without input / output
   * parameters get the default mapping of a new element (`MAP_ALL`; `MAP_ALL_OUTPUTS` on a multi-instance user task; a signal catch
   * event gets none), because Camunda hands their variables to the process by itself. `none` writes no such mapping.
   */
  defaultMappings?: 'mapAll' | 'none';
  /** The DMN decision a business rule task names, when the project has its file: its inputs and outputs are mapped. */
  decision?: (reference: string) => DecisionInfo | undefined;
  /** Source of ids for the properties that declare output targets (deterministic in tests). */
  newId?: () => string;
}

export interface ConversionResult {
  /** The file contained Camunda extensions and `xml` is the converted text; false: `xml` is the input. */
  converted: boolean;
  xml: string;
  /** The extensions file after the conversion (the given one with the new entries); undefined when nothing was converted. */
  extensions?: ExtensionsFile;
  extensionsJson?: string;
  report: LossReport;
  detection: CamundaDetection;
}
