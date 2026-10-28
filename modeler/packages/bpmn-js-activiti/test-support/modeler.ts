import { activitiModdleExtensions, ActivitiModule } from '../src';
import { AccessorsModule } from '../src/modules/accessors';
import { BehaviorsModule } from '../src/modules/behaviors/behaviors';
import { ExtensionsModule } from '../src/modules/extensions';
import BpmnModeler from 'bpmn-js/lib/Modeler';

import type { CommandStack, DiagramElement, ElementRegistry, Modeling } from '../src/types';

export interface TestModeler {
  modeler: BpmnModeler;
  get<T>(name: string): T;
  element(id: string): DiagramElement;
  modeling: Modeling;
  commandStack: CommandStack;
  registry: ElementRegistry;
  destroy(): void;
}

export const EMPTY_PROCESS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:activiti="http://activiti.org/bpmn" id="Definitions_1" targetNamespace="http://activiti.org/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="179" y="159" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

export interface CreateOptions {
  /** A subset of the Activiti modules, to prove what a module contributes. Default: all of them. */
  modules?: Array<'extensions' | 'accessors' | 'behaviors'>;
  /** More didi modules next to the Activiti ones, e.g. `CreateAppendAnythingModule` to test the real create / append menus. */
  extraModules?: unknown[];
  /** bpmn-js options, e.g. `{ activitiExtensions: { defaultMappings: 'none' } }`. */
  config?: Record<string, unknown>;
}

const PARTIAL = { extensions: ExtensionsModule, accessors: AccessorsModule, behaviors: BehaviorsModule };

export async function createModeler(xml: string = EMPTY_PROCESS, options: CreateOptions = {}): Promise<TestModeler> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modeler = new BpmnModeler({
    container,
    moddleExtensions: { ...activitiModdleExtensions } as never,
    ...options.config,
    additionalModules: [...(options.modules ? options.modules.map((m) => PARTIAL[m]) : [ActivitiModule]), ...(options.extraModules ?? [])],
  } as never);
  const { warnings } = await modeler.importXML(xml);
  if (warnings.length > 0) throw new Error(`import warnings: ${warnings.map((w) => String((w as { message?: string }).message ?? w)).join('; ')}`);
  const get = <T>(name: string): T => modeler.get<T>(name as never);
  const registry = get<ElementRegistry>('elementRegistry');
  return {
    modeler,
    get,
    modeling: get<Modeling>('modeling'),
    commandStack: get<CommandStack>('commandStack'),
    registry,
    element: (id) => {
      const el = registry.get(id);
      if (!el) throw new Error(`no element ${id}`);
      return el;
    },
    destroy: () => {
      modeler.destroy();
      container.remove();
    },
  };
}
