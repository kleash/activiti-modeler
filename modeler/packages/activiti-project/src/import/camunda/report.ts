import type { LossReport, ReportEntry } from './types';

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

const SECTIONS: Array<{ kind: ReportEntry['kind']; title: string; intro: string }> = [
  { kind: 'dropped', title: 'Dropped', intro: 'Nothing of this exists in Activiti. The behaviour is gone; decide whether the model needs another way to do it.' },
  { kind: 'approximated', title: 'Converted with differences', intro: 'These were translated, but Activiti does not behave exactly like Camunda here.' },
  { kind: 'info', title: 'Notes', intro: 'Metadata and defaults without a change in behaviour.' },
];

/** The report as Markdown: a table of what was dropped (element, what, why), then what differs, then the translations that were made. */
export function lossReportMarkdown(report: LossReport, now: Date = new Date()): string {
  const lines: string[] = [];
  const { counts } = report;
  lines.push(`# Camunda 7 import report: ${report.source}`, '');
  lines.push(`Converted ${counts.converted} attribute${counts.converted === 1 ? '' : 's'} and element${counts.converted === 1 ? '' : 's'} to Activiti 9; ${counts.dropped} could not be translated${counts.approximated > 0 ? ` and ${counts.approximated} differ in behaviour` : ''}.`, '');
  lines.push(`Created ${now.toISOString()} by the Activiti modeler.`, '');
  for (const note of report.general) lines.push(`> ${note}`, '');
  for (const section of SECTIONS) {
    const entries = report.entries.filter((e) => e.kind === section.kind);
    if (entries.length === 0) continue;
    lines.push(`## ${section.title} (${entries.length})`, '', section.intro, '');
    lines.push('| Element | Type | Item | What happened | Why |', '|---|---|---|---|---|');
    for (const e of entries) {
      lines.push(`| ${cell(code(e.elementId || '(file)'))}${e.elementName ? ` ${cell(e.elementName)}` : ''} | ${cell(e.elementType)} | ${cell(code(e.item))} | ${cell(e.what)} | ${cell(e.why)} |`);
    }
    lines.push('');
  }
  if (report.entries.length === 0) lines.push('Nothing was lost.', '');
  if (report.converted.length > 0) {
    lines.push(`## Converted (${report.converted.length})`, '', '| Element | From | To |', '|---|---|---|');
    for (const c of report.converted) lines.push(`| ${cell(code(c.elementId || '(file)'))} | ${cell(code(c.from))} | ${cell(code(c.to))} |`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
