import { type ExtensionsStore, importProcess } from '@activiti-modeler/bpmn-js-activiti';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type CodeDiagnostic, CodeEditor } from './CodeEditor';
import { checkBpmnXml, diagnosticsFromError } from './diagnostics';
import type { ModelerLike } from './modeler';

export interface PendingEdits {
  /** True while the source differs from the diagram. */
  pending(): boolean;
  /** Applies the source to the diagram; resolves to false (with markers shown) if it does not parse. */
  apply(): Promise<boolean>;
}

interface Props {
  modeler: ModelerLike;
  /** Base name for the extensions document. */
  name: string;
  register(edits: PendingEdits | undefined): void;
  /** The diagram was replaced by the source: warnings of the import. */
  onApplied(warnings: string[]): void;
}

function processIds(modeler: ModelerLike): string[] {
  const roots = (modeler.getDefinitions()?.get('rootElements') as Array<{ $instanceOf(type: string): boolean; id?: string }> | undefined) ?? [];
  return roots.filter((r) => r.$instanceOf('bpmn:Process')).map((r) => r.id as string);
}

/** The BPMN XML in a CodeMirror editor. Edits are applied to the canvas explicitly; XML that does not parse is marked and never applied. */
export function XmlView({ modeler, name, register, onApplied }: Props) {
  const [doc, setDoc] = useState<{ text: string; version: number } | undefined>();
  const [pending, setPending] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CodeDiagnostic[]>([]);
  const [status, setStatus] = useState<string>('');
  const current = useRef('');
  const base = useRef('');

  useEffect(() => {
    let alive = true;
    void modeler.saveXML({ format: true }).then(({ xml }) => {
      if (!alive) return;
      base.current = current.current = xml ?? '';
      setDoc({ text: xml ?? '', version: 0 });
    });
    return () => {
      alive = false;
    };
  }, [modeler]);

  const apply = useCallback(async (): Promise<boolean> => {
    const source = current.current;
    const check = await checkBpmnXml(source);
    if (check.diagnostics.length > 0) {
      setDiagnostics(check.diagnostics);
      setStatus(`The XML does not parse: ${check.diagnostics[0]!.message}`);
      return false;
    }
    const store = modeler.get<ExtensionsStore>('extensionsStore');
    const previous = (await modeler.saveXML({ format: true })).xml ?? '';
    const previousExtensions = store.serialize(processIds(modeler), name);
    try {
      const { warnings } = await importProcess(modeler, { xml: source, extensionsJson: previousExtensions, name });
      base.current = source;
      setPending(false);
      setDiagnostics([]);
      setStatus('Applied to the diagram');
      onApplied(warnings);
      return true;
    } catch (error) {
      // the diagram must not be lost because the source cannot be shown
      try {
        await importProcess(modeler, { xml: previous, extensionsJson: previousExtensions, name });
      } catch {
        // keep the original error; the previous XML came from this very diagram
      }
      setDiagnostics(diagnosticsFromError(error, source));
      setStatus(`The diagram could not be built from this XML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      return false;
    }
  }, [modeler, name, onApplied]);

  useEffect(() => {
    register({ pending: () => current.current !== base.current, apply });
    return () => register(undefined);
  }, [apply, register]);

  const revert = (): void => {
    current.current = base.current;
    setDoc((d) => ({ text: base.current, version: (d?.version ?? 0) + 1 }));
    setPending(false);
    setDiagnostics([]);
    setStatus('Reverted to the diagram');
  };

  return (
    <div className="source-view" data-testid="xml-view">
      <div className="source-toolbar">
        <button type="button" className="btn primary" onClick={() => void apply()} disabled={!pending} data-testid="xml-apply">
          Apply to diagram
        </button>
        <button type="button" className="btn" onClick={revert} disabled={!pending}>
          Revert
        </button>
        <span className="source-status" role="status" data-testid="xml-status">
          {status || (pending ? 'Unapplied changes' : 'In sync with the diagram')}
        </span>
      </div>
      {doc !== undefined && (
        <CodeEditor
          value={doc.text}
          version={doc.version}
          language="xml"
          label="BPMN XML source"
          testId="xml-editor"
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
