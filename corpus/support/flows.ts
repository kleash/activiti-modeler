import type { CorpusModeler } from '../../modeler/e2e/support/modelerApi';

/**
 * Connects consecutive shapes with sequence flows named like the seeds name them: `f_<source>_<target>`.
 * A flow whose id differs from that convention is created with `api.connect` directly.
 */
export async function chain(api: Pick<CorpusModeler, 'connect'>, ...ids: string[]): Promise<void> {
  for (let i = 0; i + 1 < ids.length; i += 1) await api.connect(ids[i]!, ids[i + 1]!, `f_${ids[i]}_${ids[i + 1]}`);
}
