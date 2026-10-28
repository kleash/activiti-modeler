import { classifyFile, type ProjectFileData } from '@activiti-modeler/activiti-project';
import { useEffect, useMemo, useRef, useState } from 'react';

import { editorFor, getEditor } from '../state/editorRegistry';
import type { EditorProps } from '../state/types';
import { type CodeDiagnostic, type CodeLanguage, CodeEditor } from './CodeEditor';
import { checkExtensionsJson, offsetOf } from './diagnostics';

const WORKING_COPY_DELAY_MS = 500;

export function languageOf(path: string): CodeLanguage {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json') || lower.endsWith('.form')) return 'json';
  if (lower.endsWith('.xml') || lower.endsWith('.dmn') || lower.endsWith('.bpmn')) return 'xml';
  return 'text';
}

function jsonSyntaxDiagnostics(text: string): CodeDiagnostic[] {
  try {
    JSON.parse(text);
    return [];
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const lineCol = /line (\d+) column (\d+)/.exec(message);
    const position = /position (\d+)/.exec(message)?.[1];
    const from = lineCol ? offsetOf(text, Number(lineCol[1]), Number(lineCol[2])) : position ? Number(position) : 0;
    return [{ from: Math.min(from, Math.max(0, text.length - 1)), to: Math.min(from + 1, text.length), message: `Invalid JSON: ${message}`, severity: 'error' }];
  }
}

/**
 * The plain text editor: scenario, connector and other JSON files, DMN files that are no DMN (the DMN editor opens real ones), and the
 * fail-safe for any file another editor could not open. Unsaved text is kept in the project as a working copy and draft.
 */
export function TextTabEditor({ tab, host, active }: EditorProps) {
  const ws = host.workspace;
  const initial = useMemo(() => ws.model.read(tab.path) ?? '', [ws, tab.path]);
  const text = useRef(initial);
  const pathRef = useRef(tab.path);
  pathRef.current = tab.path;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const language = languageOf(tab.path);
  const [diagnostics, setDiagnostics] = useState<CodeDiagnostic[]>(() => (language === 'json' ? jsonSyntaxDiagnostics(initial) : []));
  const kind = classifyFile(tab.path);

  const diagnose = (value: string): CodeDiagnostic[] => {
    if (language !== 'json') return [];
    return kind === 'extensions' ? checkExtensionsJson(value).diagnostics : jsonSyntaxDiagnostics(value);
  };

  const flush = async (): Promise<void> => {
    clearTimeout(timer.current);
    const path = pathRef.current;
    if (ws.model.has(path) || ws.model.isDirty(path)) await ws.edit(path, text.current);
  };

  useEffect(() => {
    host.setHandle({
      async serialize(target: string): Promise<ProjectFileData[]> {
        return [{ path: target, content: text.current }];
      },
      markSaved: () => host.setDirty(false),
      focus: () => document.querySelector<HTMLElement>('.editor-panel.active .cm-content')?.focus(),
    });
    host.setDirty(ws.model.isDirty(tab.path));
    return () => {
      clearTimeout(timer.current);
      host.setHandle(undefined);
    };
    // the handle reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active) document.querySelector<HTMLElement>('.editor-panel.active .cm-content')?.focus();
  }, [active]);

  const preferred = editorFor(tab.path);
  const reopen = preferred && preferred.id !== tab.editor ? preferred : undefined;

  return (
    <div className="text-editor">
      {reopen && (
        <div className="notice" role="note">
          This file is open as text.{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              void flush().then(() => host.openWith(reopen.id));
            }}
          >
            Open it in the {getEditor(reopen.id)?.label ?? reopen.id} editor
          </button>
        </div>
      )}
      <CodeEditor
        value={initial}
        language={language}
        label={`${tab.title} source`}
        testId="text-editor"
        diagnostics={diagnostics}
        onChange={(next) => {
          text.current = next;
          host.setDirty(next !== ws.model.saved(pathRef.current));
          setDiagnostics(diagnose(next));
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), WORKING_COPY_DELAY_MS);
        }}
      />
    </div>
  );
}
