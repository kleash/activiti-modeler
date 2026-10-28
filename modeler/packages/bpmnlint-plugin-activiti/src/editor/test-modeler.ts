/** A real bpmn-js modeler (jsdom) with the Activiti modules and the lint module, for the editor tests. */
import { activitiModdleExtensions, ActivitiModule, exportProcess, importProcess } from '@activiti-modeler/bpmn-js-activiti';
import BpmnModeler from 'bpmn-js/lib/Modeler';

import { NAMESPACES } from '../testing';
import { ActivitiLintModule, type ActivitiLinting } from './index';
import type { Problem } from '../types';

export interface LintModeler {
  modeler: BpmnModeler;
  get<T>(name: string): T;
  linting: ActivitiLinting;
  /** Lints now and returns the problems. */
  lint(): Promise<Problem[]>;
  open(xml: string, extensionsJson?: string): Promise<void>;
  exportXml(): Promise<string>;
  destroy(): void;
}

/** jsdom cannot measure label shapes, so bpmn-js' label link (a dotted line from an away label to its element) is switched off here. */
const NoLabelLink = { __init__: ['labelLink'], labelLink: ['type', function NoLabelLink() {}] };

export async function createLintModeler(xml?: string, extensionsJson?: string, delay = 5): Promise<LintModeler> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modeler = new BpmnModeler({
    container,
    moddleExtensions: { ...activitiModdleExtensions },
    additionalModules: [ActivitiModule, ActivitiLintModule, NoLabelLink],
    linting: { active: true },
    activitiLint: { delay },
  } as never);
  const get = <T>(name: string): T => modeler.get<T>(name as never);
  const result: LintModeler = {
    modeler,
    get,
    linting: get<ActivitiLinting>('activitiLinting'),
    lint: () => result.linting.lintNow(),
    open: async (source, extensions) => {
      await importProcess(modeler as never, { xml: source, ...(extensions !== undefined ? { extensionsJson: extensions } : {}), name: 'test' });
    },
    exportXml: async () => (await exportProcess(modeler as never, 'test')).xml,
    destroy: () => {
      modeler.destroy();
      container.remove();
    },
  };
  if (xml) await result.open(xml, extensionsJson);
  return result;
}

/** A complete BPMN document around the given process body, with a diagram for the listed shapes. */
export function documentWith(body: string, shapes: Array<{ id: string; x: number; y: number; w?: number; h?: number }> = [], defs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions ${NAMESPACES} id="Definitions_1" targetNamespace="urn:test">
${defs}
  <process id="p" isExecutable="true">
${body}
  </process>
  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">
${shapes.map((s) => `    <bpmndi:BPMNShape id="${s.id}_di" bpmnElement="${s.id}"><dc:Bounds x="${s.x}" y="${s.y}" width="${s.w ?? 100}" height="${s.h ?? 80}"/></bpmndi:BPMNShape>`).join('\n')}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>
`;
}
