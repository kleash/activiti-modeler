import { DiagramBuilder } from '../src/builder';
import { createModeler, EMPTY_PROCESS, type CreateOptions, type TestModeler } from './modeler';

export interface Built extends TestModeler {
  builder: DiagramBuilder;
}

/** A modeler with the Activiti modules and a builder, on the empty process (one start event). */
export async function createBuilt(xml: string = EMPTY_PROCESS, options: CreateOptions = {}): Promise<Built> {
  const t = await createModeler(xml, options);
  return { ...t, builder: new DiagramBuilder(t.modeler as never) };
}
