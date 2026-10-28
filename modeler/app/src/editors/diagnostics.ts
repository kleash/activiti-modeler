import { activitiModdleExtensions } from '@activiti-modeler/bpmn-js-activiti';
import { findUnknownFields, parseExtensions } from '@activiti-modeler/activiti-project';
import { BpmnModdle } from 'bpmn-moddle';

import type { CodeDiagnostic } from './CodeEditor';

/** Offset of a 1-based line / column in a text. */
export function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  for (let i = 1; i < line; i += 1) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return Math.min(text.length, offset + Math.max(0, column - 1));
}

/** The range of the word / tag at `from` (so that the marker underlines something visible). */
function rangeAt(text: string, from: number): { from: number; to: number } {
  const match = /^[^\s<>]+|^<[^\s>]*/.exec(text.slice(from, from + 80));
  const lineEnd = text.indexOf('\n', from);
  const to = match ? from + match[0].length : Math.min(lineEnd < 0 ? text.length : lineEnd, from + 1);
  return { from, to: Math.max(to, from + 1) };
}

/** Turns a parser or import error into editor markers. moddle's messages carry `line: N` and `column: M`. */
export function diagnosticsFromError(error: unknown, text: string): CodeDiagnostic[] {
  const message = error instanceof Error ? error.message : String(error);
  const line = /line:\s*(\d+)/.exec(message)?.[1];
  const column = /column:\s*(\d+)/.exec(message)?.[1];
  const headline = message.split('\n')[0]!.trim();
  const nested = /nested error:\s*(.+)/.exec(message)?.[1]?.trim();
  const text1 = nested ? `${headline}: ${nested}` : headline;
  const from = line ? offsetOf(text, Number(line), column ? Number(column) : 1) : 0;
  return [{ ...rangeAt(text, from), message: text1, severity: 'error' }];
}

const moddle = new BpmnModdle({ ...activitiModdleExtensions } as never);

export interface XmlCheck {
  diagnostics: CodeDiagnostic[];
  /** Non-fatal findings of the parser (e.g. unresolved references). */
  warnings: string[];
}

/** First well-formedness error of an XML text from the browser's strict parser; the moddle parser is lenient (unquoted attributes pass). */
export function wellFormednessError(text: string): { line: number; column: number; message: string } | undefined {
  if (typeof DOMParser === 'undefined') return undefined;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (!error) return undefined;
  const raw = error.textContent ?? '';
  // Chromium: "error on line 4 at column 46: message"; jsdom: "4:46: message"
  const chromium = /error on line (\d+) at column (\d+):\s*([^\n]*)/.exec(raw);
  if (chromium) return { line: Number(chromium[1]), column: Number(chromium[2]), message: chromium[3]!.trim() };
  const plain = /^(\d+):(\d+):\s*(.*)$/m.exec(raw);
  if (plain) return { line: Number(plain[1]), column: Number(plain[2]), message: plain[3]!.trim() };
  return { line: 1, column: 1, message: raw.trim().split('\n')[0] ?? 'The XML is not well-formed' };
}

/** Parses BPMN XML with the Activiti moddle without touching the canvas; the XML source view applies only what parses. */
export async function checkBpmnXml(text: string): Promise<XmlCheck> {
  const strict = wellFormednessError(text);
  if (strict) {
    const from = offsetOf(text, strict.line, strict.column);
    return { diagnostics: [{ ...rangeAt(text, from), message: `XML is not well-formed: ${strict.message}`, severity: 'error' }], warnings: [] };
  }
  try {
    const { warnings } = await moddle.fromXML(text, 'bpmn:Definitions');
    return { diagnostics: [], warnings: warnings.map((w) => w.message) };
  } catch (error) {
    return { diagnostics: diagnosticsFromError(error, text), warnings: [] };
  }
}

/** Markers for the text of an extensions JSON: syntax errors, wrong structure (errors) and fields Activiti drops (warnings). */
export function checkExtensionsJson(text: string): { diagnostics: CodeDiagnostic[]; valid: boolean } {
  const diagnostics: CodeDiagnostic[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const lineCol = /line (\d+) column (\d+)/.exec(message);
    const position = /position (\d+)/.exec(message)?.[1];
    const from = lineCol ? offsetOf(text, Number(lineCol[1]), Number(lineCol[2])) : position ? Number(position) : 0;
    diagnostics.push({ ...rangeAt(text, Math.min(from, Math.max(0, text.length - 1))), message: `Invalid JSON: ${message.replace(/ in JSON at position.*$/, '')}`, severity: 'error' });
    return { diagnostics, valid: false };
  }
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const problem = (message: string, key?: string): void => {
    const at = key ? text.indexOf(`"${key}"`) : -1;
    diagnostics.push({ ...rangeAt(text, Math.max(0, at)), message, severity: 'error' });
  };
  if (!isRecord(parsed)) {
    problem('The top level must be an object with an "extensions" object');
  } else if (!isRecord(parsed['extensions'])) {
    problem('The file needs an "extensions" object keyed by process id', 'extensions');
  } else {
    for (const [processId, ext] of Object.entries(parsed['extensions'])) {
      if (!isRecord(ext)) problem(`extensions.${processId} must be an object`, processId);
      else
        for (const part of ['properties', 'mappings', 'constants'] as const)
          if (part in ext && !isRecord(ext[part])) problem(`extensions.${processId}.${part} must be an object`, part);
    }
  }
  if (diagnostics.length > 0) return { diagnostics, valid: false };
  try {
    const file = parseExtensions(text);
    for (const path of findUnknownFields(file)) {
      const key = path.split('.').pop()?.replace(/\[.*$/, '') ?? '';
      const at = text.indexOf(`"${key}"`);
      diagnostics.push({ ...rangeAt(text, Math.max(0, at)), message: `${path}: not known to Activiti 9.0.0, dropped when the file is saved`, severity: 'warning' });
    }
  } catch (e) {
    problem(e instanceof Error ? e.message : String(e));
    return { diagnostics, valid: false };
  }
  return { diagnostics, valid: true };
}
