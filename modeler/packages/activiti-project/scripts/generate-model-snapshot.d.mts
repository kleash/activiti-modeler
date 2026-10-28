export const SNAPSHOT_PATH: string;
export interface ModelFieldsSnapshot {
  source: string;
  classes: Record<string, { properties: string[]; extends?: string }>;
}
export function extractModelFields(sources: { processExtensions: string; connectorModel: string }): ModelFieldsSnapshot;
