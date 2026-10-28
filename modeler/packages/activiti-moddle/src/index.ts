import activitiBpmnDescriptor from './descriptors/activiti.json';
import activitiDmnDescriptor from './descriptors/activiti-dmn.json';

export { ACTIVITI_CHECKLIST, type Checklist, type ChecklistEntry } from './checklist';
export * from './generated/types';

/** XML namespace of the Activiti BPMN extensions (`activiti:` attributes and elements). */
export const ACTIVITI_NAMESPACE = {
  prefix: 'activiti',
  uri: 'http://activiti.org/bpmn',
} as const;

/** XML namespace of the Activiti DMN extensions (`activiti:inputVariable`). */
export const ACTIVITI_DMN_NAMESPACE = {
  prefix: 'activiti',
  uri: 'http://activiti.org/dmn',
} as const;

/** Moddle package descriptor, as consumed by `moddleExtensions` in bpmn-js and by `new BpmnModdle({ activiti })`. */
export interface ModdlePackageDescriptor {
  name: string;
  uri: string;
  prefix: string;
  xml: { tagAlias: 'lowerCase' };
  types: readonly unknown[];
  associations?: readonly unknown[];
}

/**
 * Activiti BPMN moddle descriptor. It covers every attribute and child element the Activiti 9.0.0 converter reads
 * (`support/activiti-attributes.json`) and none of the Camunda or Zeebe concepts.
 */
export const activitiModdleDescriptor = activitiBpmnDescriptor as ModdlePackageDescriptor;

/** DMN moddle package. Its purpose is that Activiti DMN files (1.1 and later) round-trip with every foreign attribute kept. */
export const activitiDmnModdleDescriptor = activitiDmnDescriptor as ModdlePackageDescriptor;
