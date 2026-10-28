import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { type Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

export type CodeLanguage = 'xml' | 'json' | 'text';

export interface CodeDiagnostic {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

const external = Annotation.define<boolean>();

interface Props {
  value: string;
  language: CodeLanguage;
  onChange?: (text: string) => void;
  diagnostics?: CodeDiagnostic[];
  readOnly?: boolean;
  label: string;
  testId?: string;
  /** Change it to put `value` into the editor again even when `value` itself is the same text (the user typed in between). */
  version?: number;
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto' },
  '&.cm-focused': { outline: '2px solid var(--focus, #2f6fed)', outlineOffset: '-2px' },
});

/** A CodeMirror 6 editor in a React component: the document is `value` until the user types, `onChange` reports edits. */
export function CodeEditor({ value, language, onChange, diagnostics, readOnly, label, testId, version }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return undefined;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          lintGutter(),
          theme,
          language === 'xml' ? xml() : language === 'json' ? json() : [],
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          EditorState.readOnly.of(!!readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((t) => t.annotation(external))) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // the editor is created once; value / diagnostics are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, label]);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: external.of(true) });
    }
  }, [value, version, language, readOnly, label]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const length = editor.state.doc.length;
    const list: Diagnostic[] = (diagnostics ?? []).map((d) => ({ from: Math.min(d.from, length), to: Math.min(Math.max(d.to, d.from), length), message: d.message, severity: d.severity }));
    editor.dispatch(setDiagnostics(editor.state, list));
  }, [diagnostics, value, language, readOnly, label]);

  return <div ref={host} className="code-editor" data-testid={testId} />;
}
