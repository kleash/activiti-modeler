/**
 * The project as the properties panel and the element templates need it (`projectCatalog` service of a modeler): the connector
 * definitions of `connectors/` (the file and its entry in `project.json`), the decisions of the DMN files and the process ids. Built from the files of the project (their
 * working copies, so an unsaved edit of a connector shows up in the open diagrams at once) and cached per file text.
 */
import { classifyFile, connectorKeyOf, parseConnectorModel, readConnectorMeta, scanProcessIds, type ConnectorMeta, type ConnectorModel } from '@activiti-modeler/activiti-project';
import type { CatalogDmnFile, ProjectCatalog, ProjectCatalogData } from '@activiti-modeler/bpmn-js-activiti';
import { requiredInputNames, scanDmn } from '@activiti-modeler/bpmnlint-plugin-activiti';

export interface CatalogSource {
  path: string;
  content: string;
}

function dmnFile(path: string, content: string): CatalogDmnFile {
  const info = scanDmn(path, content);
  const requiredBySomeone = new Set(info.decisions.flatMap((d) => d.requiredDecisions));
  return {
    path,
    baseName: info.baseName,
    ...(info.name ? { name: info.name } : {}),
    decisions: info.decisions.map((d) => ({
      id: d.id,
      ...(d.name ? { name: d.name } : {}),
      inputs: requiredInputNames(info, d.id),
      complexInputs: d.complexInputs,
      outputs: d.outputs,
      ...(d.hitPolicy ? { hitPolicy: d.hitPolicy } : {}),
      ...(d.aggregation ? { aggregation: d.aggregation } : {}),
      sink: !requiredBySomeone.has(d.id),
    })),
  };
}

/** Parses the files of a project into the catalog; a file whose text did not change since the last call is not parsed again. */
export class CatalogBuilder {
  private readonly cache = new Map<string, { content: string; value: unknown }>();

  private cached<T>(path: string, content: string, parse: () => T): T {
    const hit = this.cache.get(path);
    if (hit && hit.content === content) return hit.value as T;
    const value = parse();
    this.cache.set(path, { content, value });
    return value;
  }

  build(files: readonly CatalogSource[]): ProjectCatalogData {
    const data: ProjectCatalogData = { connectors: [], dmn: [], processes: [] };
    const seen = new Set<string>();
    // the template version and the other modeler-only fields of a connector are in project.json (ADR 0003)
    const project = files.find((f) => f.path === 'project.json');
    const metaByConnector = project ? this.cached<Record<string, ConnectorMeta>>('project.json', project.content, () => readConnectorMeta(project.content)) : {};
    if (project) seen.add('project.json');
    for (const file of files) {
      const kind = classifyFile(file.path);
      if (kind !== 'connector' && kind !== 'dmn' && kind !== 'bpmn') continue;
      seen.add(file.path);
      if (kind === 'connector') {
        const stem = connectorKeyOf(file.path);
        const meta = metaByConnector[stem];
        const connector = this.cached<ConnectorModel | undefined>(file.path, `${file.content}\u0000${meta ? JSON.stringify(meta) : ''}`, () => parseConnectorModel(file.content, stem, meta));
        if (connector) data.connectors.push(connector);
      } else if (kind === 'dmn') {
        data.dmn.push(this.cached(file.path, file.content, () => dmnFile(file.path, file.content)));
      } else {
        for (const id of this.cached(file.path, file.content, () => scanProcessIds(file.content))) data.processes.push({ id, path: file.path });
      }
    }
    for (const path of [...this.cache.keys()]) if (!seen.has(path)) this.cache.delete(path);
    return data;
  }
}

/** Pushes `data` to the catalog of a modeler when it differs from what the catalog holds (the comparison is by value, so unrelated edits cause no refresh). */
export function pushCatalog(catalog: ProjectCatalog, data: ProjectCatalogData, last: { json?: string }): void {
  const json = JSON.stringify(data);
  if (json === last.json) return;
  last.json = json;
  catalog.set(data);
}
