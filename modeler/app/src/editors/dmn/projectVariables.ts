import { describeDmn, parseExtensions, resolveDecisionIn } from '@activiti-modeler/activiti-project';

import type { SuggestedVariable } from './dmnModeler';

const DMN_TABLE_CONSTANT = '_activiti_dmn_table_';

export interface ProjectTextFile {
  path: string;
  content: string;
}

/**
 * The process variables the FEEL editors of a DMN file suggest next to the DRD's own inputs (feature DM7): for every decision task of
 * the project that names a decision of this file, the variables its process declares (`properties` of the extensions file), with their
 * type. A project without such a task suggests nothing extra; the DRD's own inputs always come from the diagram.
 */
export function processVariablesFor(dmnPath: string, files: readonly ProjectTextFile[]): SuggestedVariable[] {
  const dmn = files.find((f) => f.path === dmnPath);
  if (!dmn) return [];
  const description = describeDmn(dmn.content);
  if (description.error) return [];
  const baseName = dmnPath.slice(dmnPath.lastIndexOf('/') + 1).replace(/\.dmn$/, '');
  const found = new Map<string, SuggestedVariable>();
  for (const file of files) {
    if (!file.path.endsWith('-extensions.json')) continue;
    let parsed;
    try {
      parsed = parseExtensions(file.content, file.path);
    } catch {
      continue;
    }
    for (const [processId, extension] of Object.entries(parsed.extensions)) {
      const callsThisFile = Object.values(extension.constants ?? {}).some((constants) => {
        const value = constants[DMN_TABLE_CONSTANT]?.value;
        return typeof value === 'string' && resolveDecisionIn(description, baseName, value) !== undefined;
      });
      if (!callsThisFile) continue;
      for (const definition of Object.values(extension.properties ?? {})) {
        if (!definition.name || found.has(definition.name)) continue;
        found.set(definition.name, { name: definition.name, detail: String(definition.type), info: `Process variable of ${processId}` });
      }
    }
  }
  return [...found.values()];
}
