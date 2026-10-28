import { EXTENSIONS_CHANGED, type ExtensionsStore } from '@activiti-modeler/bpmn-js-activiti';
import { cloneExtensions, parseExtensions, type ExtensionsFile } from '@activiti-modeler/activiti-project';
import { useEffect, useRef, useState } from 'react';

import { type CodeDiagnostic, CodeEditor } from './CodeEditor';
import { checkExtensionsJson } from './diagnostics';
import type { PendingEdits } from './XmlView';
import type { ModelerLike } from './modeler';

interface EventBus {
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
}

interface Props {
  modeler: ModelerLike;
  name: string;
  processIds: () => string[];
  register(edits: PendingEdits | undefined): void;
}

/**
 * The extensions JSON of the open process. Valid edits go into the extensions store as one undoable command; JSON that does not
 * parse is marked and never applied. When the store changes elsewhere (undo, the properties panel) the text follows.
 */
export function JsonView({ modeler, name, processIds, register }: Props) {
  const store = modeler.get<ExtensionsStore>('extensionsStore');
  const [doc, setDoc] = useState(() => ({ text: store.serialize(processIds(), name), version: 0 }));
  const text = doc.text;
  const [diagnostics, setDiagnostics] = useState<CodeDiagnostic[]>([]);
  const [status, setStatus] = useState('');
  const invalid = useRef(false);
  const applied = useRef(text);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(text);

  const applyNow = (source: string): boolean => {
    const check = checkExtensionsJson(source);
    setDiagnostics(check.diagnostics);
    invalid.current = !check.valid;
    if (!check.valid) {
      setStatus('Not applied: fix the errors first');
      return false;
    }
    const parsed: ExtensionsFile = parseExtensions(source, name);
    const normalised = store.serialize(processIds(), name);
    // nothing to do when the text already describes the store
    if (JSON.stringify(parsed) !== JSON.stringify(parseExtensions(normalised, name))) {
      editing.current = true;
      try {
        store.update('edit extensions JSON', (file) => {
          for (const key of Object.keys(file)) delete file[key];
          Object.assign(file, cloneExtensions(parsed));
        });
      } finally {
        editing.current = false;
      }
    }
    applied.current = source;
    setStatus('Applied to the extensions store');
    return true;
  };

  useEffect(() => {
    const bus = modeler.get<EventBus>('eventBus');
    const onChanged = (): void => {
      if (editing.current) return;
      // the store changed elsewhere: show it, unless the user is in the middle of an edit that is not applied
      const next = store.serialize(processIds(), name);
      if (invalid.current) return;
      if (next !== latest.current) {
        latest.current = next;
        applied.current = next;
        setDoc((d) => ({ text: next, version: d.version + 1 }));
        setDiagnostics(checkExtensionsJson(next).diagnostics);
      }
    };
    bus.on(EXTENSIONS_CHANGED, onChanged);
    return () => bus.off(EXTENSIONS_CHANGED, onChanged);
  }, [modeler, store, name, processIds]);

  useEffect(() => {
    register({
      pending: () => invalid.current || latest.current !== applied.current,
      apply: async () => {
        clearTimeout(timer.current);
        return applyNow(latest.current);
      },
    });
    return () => register(undefined);
    // applyNow only uses refs and stable values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, store, name]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="source-view" data-testid="json-view">
      <div className="source-toolbar">
        <span className="source-status" role="status" data-testid="json-status">
          {status || 'Edits are applied while you type, as long as the JSON is valid'}
        </span>
      </div>
      <CodeEditor
        value={doc.text}
        version={doc.version}
        language="json"
        label="Extensions JSON"
        testId="json-editor"
        diagnostics={diagnostics}
        onChange={(next) => {
          latest.current = next;
          clearTimeout(timer.current);
          // applying while typing is quick, but not on every key stroke
          timer.current = setTimeout(() => applyNow(next), 250);
        }}
      />
    </div>
  );
}
