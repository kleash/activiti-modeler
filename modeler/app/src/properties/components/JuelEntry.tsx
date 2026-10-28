/** @jsxImportSource @bpmn-io/properties-panel/preact */
import { type Diagnostic as CmDiagnostic, setDiagnostics } from '@codemirror/lint';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, placeholder as placeholderExtension } from '@codemirror/view';
import { useShowEntryEvent, type PanelDiagnostic } from '@bpmn-io/properties-panel';
import type { ComponentChildren } from '@bpmn-io/properties-panel/preact';
import { useEffect, useMemo, useRef, useState } from '@bpmn-io/properties-panel/preact/hooks';
import { basicSetup } from 'codemirror';

import { completeJuel } from '../juel/completion';
import { juelLanguage } from '../juel/language';
import { checkJuel } from '../juel/syntax';
import { EntryLabel, EntryShell, blocks, useEntryDiagnostic, type Diagnostic } from './shared';
import type { VariableSuggestion } from '@activiti-modeler/bpmn-js-activiti';

export interface JuelEntryProps {
  element: { id: string };
  id: string;
  label: ComponentChildren;
  getValue(element: unknown): string | undefined;
  setValue(value: string | undefined, error?: Diagnostic | PanelDiagnostic | null): void;
  /** Extra validation on top of the syntax check (the entry's own rules). */
  validate?(value: string | undefined): Diagnostic | undefined;
  /** `expression`: text with `${}`; `condition`: one boolean `${}`; `block`: script code. */
  mode?: 'expression' | 'condition' | 'block';
  /** `plain`: a script in a language the editor does not know (JavaScript): no expression checks, no highlighting. */
  language?: 'juel' | 'plain';
  debounce(fn: (...args: never[]) => unknown): ((...args: never[]) => unknown) & { flush?: () => void; cancel?: () => void };
  variables(): VariableSuggestion[];
  tooltip?: ComponentChildren;
  description?: ComponentChildren;
  placeholder?: string;
  /** Visible lines at least. */
  rows?: number;
  disabled?: boolean;
  /** The element, handed to the completion sources. */
  diagramElement?: unknown;
}

const external = Annotation.define<boolean>();

const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'var(--bio-input-background, #fff)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: '2px solid var(--focus, #2f6fed)', outlineOffset: '-1px' },
});

/** An expression field: a small CodeMirror editor with JUEL highlighting, bracket matching, syntax checks and variable completion. */
export function JuelEntry(props: JuelEntryProps) {
  // the editor belongs to the element: another selection builds a new one
  return <JuelBody key={props.element.id} {...props} />;
}

function JuelBody(props: JuelEntryProps) {
  const { element, id, label, tooltip, description, getValue, mode = 'expression', language = 'juel', rows = 1, disabled } = props;
  const value = getValue(element) ?? '';
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const focusRef = useShowEntryEvent(id);
  const [local, setLocal] = useState<Diagnostic | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const commit = useMemo(() => {
    const run = (): void => {
      const current = latest.current;
      const editor = view.current;
      if (!editor) return;
      const text = editor.state.doc.toString();
      const next = text === '' ? undefined : text;
      if (next === current.getValue(current.element)) return;
      const problem = current.validate?.(next) ?? syntaxDiagnostic(next, current.mode ?? 'expression', current.language ?? 'juel');
      setLocal(problem ?? null);
      current.setValue(next, problem ?? null);
    };
    const debounced = props.debounce(run);
    return Object.assign(debounced, { now: run });
    // `debounce` is the panel's factory result and never changes for a modeler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.debounce]);

  useEffect(() => {
    if (!host.current) return undefined;
    const block = mode === 'block';
    // the underlines of syntax problems: set after a pause, from outside the update that changed the text
    let lintTimer: ReturnType<typeof setTimeout> | undefined;
    const lintNow = (): void => {
      const target = view.current;
      if (!target || language !== 'juel') return;
      const text = target.state.doc.toString();
      const marks: CmDiagnostic[] = checkJuel(text, { mode: latest.current.mode ?? 'expression' }).map((p) => ({
        from: Math.min(p.from, text.length),
        to: Math.min(Math.max(p.to, p.from + 1), text.length),
        severity: p.severity,
        message: p.message,
      }));
      target.dispatch(setDiagnostics(target.state, marks));
    };
    const scheduleLint = (): void => {
      clearTimeout(lintTimer);
      lintTimer = setTimeout(lintNow, 250);
    };
    const completionData = [
      {
        autocomplete: async (context: { state: EditorState; pos: number; explicit: boolean }) => {
          if (language !== 'juel') return null;
          const result = await completeJuel(context.state.doc.toString(), context.pos, {
            variables: () => latest.current.variables(),
            block,
            ...(latest.current.diagramElement ? { element: latest.current.diagramElement as never } : {}),
          });
          if (!result) return null;
          return {
            from: result.from,
            validFor: /^[\w$]*$/,
            options: result.options.map((o) => ({ label: o.label, type: o.kind === 'variable' ? 'variable' : o.kind === 'keyword' ? 'keyword' : o.kind === 'bean' ? 'class' : o.kind === 'env' ? 'constant' : 'function', detail: o.detail, info: o.info })),
          };
        },
      },
    ];
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          theme,
          language === 'juel' ? juelLanguage(block) : [],
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': typeof label === 'string' ? label : id, spellcheck: 'false' }),
          EditorState.readOnly.of(!!disabled),
          placeholderExtension(props.placeholder ?? ''),
          // completion: the autocompletion of basicSetup asks the language data of the position; the source must be the same
          // function each time (a new one at every call restarts the completion forever)
          EditorState.languageData.of(() => completionData),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) scheduleLint();
            if (update.docChanged && !update.transactions.some((t) => t.annotation(external))) commit();
          }),
          EditorView.domEventHandlers({
            blur: () => {
              commit.cancel?.();
              commit.now();
            },
          }),
        ],
      }),
    });
    view.current = editor;
    lintNow();
    focusRef.current = editor.contentDOM as never;
    // a short editor keeps its height; a script gets room
    editor.dom.style.minHeight = `${Math.max(1, rows) * 1.5 + 0.6}em`;
    return () => {
      clearTimeout(lintTimer);
      commit.cancel?.();
      editor.destroy();
      view.current = null;
      focusRef.current = null;
    };
    // built once per element; the value, validation and suggestions are read through refs and the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, language, disabled]);

  // the model changed from outside (undo, another field): show it, unless the user is typing
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.hasFocus) return;
    if (editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: external.of(true) });
  }, [value]);

  const diagnostic = useEntryDiagnostic(id, local ?? props.validate?.(value === '' ? undefined : value) ?? syntaxDiagnostic(value === '' ? undefined : value, mode, language));
  return (
    <EntryShell id={id} element={element} diagnostic={diagnostic} description={description} className="activiti-juel-entry">
      <EntryLabel id={id} label={label} tooltip={tooltip} element={element} htmlFor={`bio-properties-panel-${id}`} />
      <div ref={host} class="activiti-juel-editor" id={`bio-properties-panel-${id}`} />
    </EntryShell>
  );
}

/** The first problem of an expression as the panel shows it below the field (errors block the write, warnings do not). */
export function syntaxDiagnostic(text: string | undefined, mode: 'expression' | 'condition' | 'block', language: 'juel' | 'plain'): Diagnostic | undefined {
  if (language !== 'juel' || !text) return undefined;
  const problems = checkJuel(text, { mode });
  const first = problems.find((p) => p.severity === 'error') ?? problems[0];
  return first ? { message: first.message, severity: first.severity } : undefined;
}

export { blocks };
