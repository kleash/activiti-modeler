import { useCallback, useEffect, useRef, useState } from 'react';

import { type CodeDiagnostic, CodeEditor } from '../CodeEditor';
import { diagnosticsFromError, wellFormednessError, offsetOf } from '../diagnostics';

export interface PendingDmnEdits {
  pending(): boolean;
  /** Applies the source to the editor; false (with markers shown) when it does not read as DMN. */
  apply(): Promise<boolean>;
}

interface Props {
  /** The text of the model as it would be saved. */
  load(): Promise<string>;
  /** Puts the text into the editor; throws when the editor cannot read it. */
  applyText(text: string): Promise<void>;
  register(edits: PendingDmnEdits | undefined): void;
  onApplied(): void;
}

/** The DMN XML in a CodeMirror editor. The text is applied to the editor explicitly; text that does not parse is marked and never applied. */
export function DmnSourceView({ load, applyText, register, onApplied }: Props) {
  const [doc, setDoc] = useState<{ text: string; version: number } | undefined>();
  const [pending, setPending] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CodeDiagnostic[]>([]);
  const [status, setStatus] = useState('');
  const current = useRef('');
  const base = useRef('');

  useEffect(() => {
    let alive = true;
    void load().then((text) => {
      if (!alive) return;
      base.current = current.current = text;
      setDoc({ text, version: 0 });
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const apply = useCallback(async (): Promise<boolean> => {
    const source = current.current;
    const strict = wellFormednessError(source);
    if (strict) {
      const from = offsetOf(source, strict.line, strict.column);
      setDiagnostics([{ from, to: Math.min(source.length, from + 1), message: `XML is not well-formed: ${strict.message}`, severity: 'error' }]);
      setStatus(`The XML does not parse: ${strict.message}`);
      return false;
    }
    try {
      await applyText(source);
      base.current = source;
      setPending(false);
      setDiagnostics([]);
      setStatus('Applied to the model');
      onApplied();
      return true;
    } catch (error) {
      setDiagnostics(diagnosticsFromError(error, source));
      setStatus(`The model could not be built from this XML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      return false;
    }
  }, [applyText, onApplied]);

  useEffect(() => {
    register({ pending: () => current.current !== base.current, apply });
    return () => register(undefined);
  }, [apply, register]);

  const revert = (): void => {
    current.current = base.current;
    setDoc((d) => ({ text: base.current, version: (d?.version ?? 0) + 1 }));
    setPending(false);
    setDiagnostics([]);
    setStatus('Reverted to the model');
  };

  return (
    <div className="source-view" data-testid="dmn-xml-view">
      <div className="source-toolbar">
        <button type="button" className="btn primary" onClick={() => void apply()} disabled={!pending} data-testid="dmn-xml-apply">
          Apply to model
        </button>
        <button type="button" className="btn" onClick={revert} disabled={!pending}>
          Revert
        </button>
        <span className="source-status" role="status" data-testid="dmn-xml-status">
          {status || (pending ? 'Unapplied changes' : 'In sync with the model')}
        </span>
      </div>
      {doc !== undefined && (
        <CodeEditor
          value={doc.text}
          version={doc.version}
          language="xml"
          label="DMN XML source"
          testId="dmn-xml-editor"
          diagnostics={diagnostics}
          onChange={(next) => {
            current.current = next;
            setPending(next !== base.current);
            setDiagnostics([]);
            setStatus('');
          }}
        />
      )}
    </div>
  );
}
