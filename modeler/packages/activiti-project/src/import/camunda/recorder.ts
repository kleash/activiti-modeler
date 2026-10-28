import type { ConvertedEntry, LossReport, ReportEntry, ReportKind } from './types';

export interface OwnerRef {
  id: string;
  name?: string;
  type: string;
}

/** Collects what the conversion did, for the report. */
export class Recorder {
  private readonly entries: ReportEntry[] = [];
  private readonly convertedList: ConvertedEntry[] = [];
  private readonly generalNotes: string[] = [];

  constructor(private readonly source: string) {}

  entry(owner: OwnerRef, kind: ReportKind, item: string, what: string, why: string): void {
    const entry: ReportEntry = { kind, elementId: owner.id, ...(owner.name ? { elementName: owner.name } : {}), elementType: owner.type, item, what, why };
    if (!this.entries.some((e) => e.elementId === entry.elementId && e.item === entry.item && e.what === entry.what)) this.entries.push(entry);
  }

  converted(owner: OwnerRef, from: string, to: string): void {
    this.convertedList.push({ elementId: owner.id, elementType: owner.type, from, to });
  }

  general(text: string): void {
    if (!this.generalNotes.includes(text)) this.generalNotes.push(text);
  }

  /** `order`: position of each element id in the document; entries and translations are listed in that order. */
  report(order?: ReadonlyMap<string, number>): LossReport {
    const count = (kind: ReportKind): number => this.entries.filter((e) => e.kind === kind).length;
    const position = (id: string): number => (id === '' ? -1 : (order?.get(id) ?? Number.MAX_SAFE_INTEGER));
    const byPosition = <T extends { elementId: string }>(list: T[]): T[] => (order ? list.map((item, index) => ({ item, index })).sort((a, b) => position(a.item.elementId) - position(b.item.elementId) || a.index - b.index).map((x) => x.item) : [...list]);
    return {
      source: this.source,
      general: [...this.generalNotes],
      entries: byPosition(this.entries),
      converted: byPosition(this.convertedList),
      counts: { converted: this.convertedList.length, dropped: count('dropped'), approximated: count('approximated'), info: count('info') },
    };
  }
}
