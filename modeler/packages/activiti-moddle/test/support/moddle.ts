import { BpmnModdle, type ModdleElement, type ModdleImportResult } from 'bpmn-moddle';

import { activitiModdleDescriptor } from '../../src';

export function createModdle(): BpmnModdle {
  return new BpmnModdle({ activiti: activitiModdleDescriptor as never });
}

export interface Imported {
  moddle: BpmnModdle;
  result: ModdleImportResult;
  definitions: ModdleElement;
}

export async function importXml(xml: string): Promise<Imported> {
  const moddle = createModdle();
  const result = await moddle.fromXML(xml);
  return { moddle, result, definitions: result.rootElement };
}

export async function exportXml(imported: Imported): Promise<string> {
  const { xml } = await imported.moddle.toXML(imported.definitions, { format: true });
  return xml;
}

/** Depth-first list of every moddle element reachable from `root` (containment only, references are skipped). */
export function walk(root: ModdleElement): ModdleElement[] {
  const out: ModdleElement[] = [];
  const seen = new Set<ModdleElement>();
  const visit = (el: ModdleElement): void => {
    if (seen.has(el)) return;
    seen.add(el);
    out.push(el);
    for (const property of el.$descriptor?.properties ?? []) {
      if (property.isReference || property.type === 'String' || property.type === 'Boolean') continue;
      const value = el.get(property.name);
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && '$type' in child) visit(child as ModdleElement);
      }
    }
  };
  visit(root);
  return out;
}
