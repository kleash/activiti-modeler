// @vitest-environment jsdom
import { MemoryStorage, ProjectWorkspace, type ProjectFileData } from '@activiti-modeler/activiti-project';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorHandle, EditorHost, TabState } from '../state/types';
import { DEFAULT_SETTINGS } from '../state/settings';
import { DEFAULT_LAYOUT } from '../state/layout';
import { ConnectorTabEditor } from './ConnectorEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** U15: what the connector editor hands to Save. The version and the configuration live in project.json, next to the runtime file. */

const PATH = 'connectors/mailer.json';
const CONNECTOR = JSON.stringify(
  {
    id: 'mailer',
    name: 'mailer',
    description: 'Sends mail',
    actions: { SEND: { id: 'SEND', name: 'Send', description: 'Sends one mail', inputs: [{ id: 'to', name: 'to', type: 'text', required: true }], outputs: [{ id: 'sent', name: 'sent', type: 'boolean' }] } },
    events: {},
  },
  null,
  2,
);

interface Mounted {
  ws: ProjectWorkspace;
  handle: () => EditorHandle;
  root: Root;
  container: HTMLElement;
  dirty: boolean[];
}

const mounted: Mounted[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount());
    m.container.remove();
  }
  vi.useRealTimers();
});

async function mount(files: Record<string, string>): Promise<Mounted> {
  const ws = await ProjectWorkspace.open(new MemoryStorage('p', Object.entries(files).map(([path, content]) => ({ path, content }))));
  let handle: EditorHandle | undefined;
  const dirty: boolean[] = [];
  const host = {
    workspace: ws,
    isMac: false,
    setHandle: (h: EditorHandle | undefined) => void (handle = h),
    setDirty: (value: boolean) => void dirty.push(value),
    setWarnings: () => undefined,
    fail: () => undefined,
    openWith: () => undefined,
    setView: () => undefined,
    toast: () => undefined,
    layout: () => DEFAULT_LAYOUT,
    setLayout: () => undefined,
    settings: () => DEFAULT_SETTINGS,
    showLossReport: () => undefined,
    requestSave: async () => undefined,
    paths: () => new Set(ws.model.paths()),
  } as unknown as EditorHost;
  const tab = { id: 't1', path: PATH, title: 'mailer.json', editor: 'connector', view: 'diagram', dirty: false, warnings: [] } as unknown as TabState;
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  act(() => root.render(<ConnectorTabEditor tab={tab} host={host} active />));
  const result: Mounted = { ws, handle: () => handle!, root, container, dirty };
  mounted.push(result);
  return result;
}

const input = (m: Mounted, testId: string): HTMLInputElement => m.container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
function type(m: Mounted, testId: string, value: string): void {
  const el = input(m, testId);
  act(() => {
    // React tracks the value of an input: set it through the native setter, then fire the event
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const project = (files: ProjectFileData[]): Record<string, unknown> | undefined => {
  const file = files.find((f) => f.path === 'project.json');
  return file ? (JSON.parse(file.content) as Record<string, unknown>) : undefined;
};

describe('U15 ConnectorEditor handle.serialize', () => {
  it('saves the descriptor as the editor holds it and, without a version or configuration, leaves project.json alone', async () => {
    const m = await mount({ [PATH]: CONNECTOR, 'project.json': '{"name":"p"}' });
    const files = await m.handle().serialize(PATH);
    expect(files.map((f) => f.path)).toEqual([PATH]);
    expect(JSON.parse(files[0]!.content)).toMatchObject({ name: 'mailer', actions: { SEND: { id: 'SEND' } } });
  });

  it('after an edit the descriptor has the new text and project.json gets the version under the key of the file', async () => {
    const m = await mount({ [PATH]: CONNECTOR, 'project.json': '{"name":"p"}' });
    type(m, 'connector-description', 'Sends mail through SMTP');
    type(m, 'connector-version', '2');
    const files = await m.handle().serialize(PATH);
    expect(JSON.parse(files[0]!.content)).toMatchObject({ description: 'Sends mail through SMTP' });
    expect(files.map((f) => f.path)).toEqual([PATH, 'project.json']);
    expect(project(files)).toMatchObject({ name: 'p', connectors: { mailer: { version: '2' } } });
  });

  it('compares with project.json as it was saved, not with the working copy: a save after the pause still writes the version', async () => {
    vi.useFakeTimers();
    const m = await mount({ [PATH]: CONNECTOR, 'project.json': '{"name":"p"}' });
    type(m, 'connector-version', '3');
    // the pause after the last edit has passed: the working copy of project.json already holds the entry
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(JSON.parse(m.ws.model.read('project.json')!)).toMatchObject({ connectors: { mailer: { version: '3' } } });
    expect(JSON.parse(m.ws.model.saved('project.json')!)).not.toHaveProperty('connectors');
    const files = await m.handle().serialize(PATH);
    expect(project(files)).toMatchObject({ connectors: { mailer: { version: '3' } } });
  });

  it('writes nothing to project.json once the saved entry equals the editor state', async () => {
    const saved = JSON.stringify({ name: 'p', connectors: { mailer: { version: '4' } } });
    const m = await mount({ [PATH]: CONNECTOR, 'project.json': saved });
    const files = await m.handle().serialize(PATH);
    expect(files.map((f) => f.path)).toEqual([PATH]);
  });

  it('creates project.json when the project has none and the connector has a version', async () => {
    const m = await mount({ [PATH]: CONNECTOR });
    type(m, 'connector-version', '1');
    const files = await m.handle().serialize(PATH);
    expect(files.map((f) => f.path)).toEqual([PATH, 'project.json']);
    expect(project(files)).toEqual({ connectors: { mailer: { version: '1' } } });
  });

  it('keeps the configuration with the version under the key of the file that is saved (Save As names a new key)', async () => {
    const m = await mount({ [PATH]: CONNECTOR, 'project.json': '{"name":"p"}' });
    act(() => input(m, 'connector-add-config').click());
    type(m, 'connector-config-0-name', 'host');
    type(m, 'connector-config-0-value', 'smtp.example.com');
    type(m, 'connector-version', '5');
    const files = await m.handle().serialize('connectors/mailer-copy.json');
    expect(files.map((f) => f.path)).toEqual(['connectors/mailer-copy.json', 'project.json']);
    expect(project(files)).toMatchObject({ connectors: { 'mailer-copy': { version: '5', config: [{ name: 'host', value: 'smtp.example.com' }] } } });
  });

  it('stops the save with a readable error when project.json is not JSON, so the tab stays unsaved', async () => {
    const m = await mount({ [PATH]: CONNECTOR, 'project.json': '{ not json' });
    type(m, 'connector-version', '2');
    await expect(m.handle().serialize(PATH)).rejects.toThrow(/project\.json/);
  });

  it('marks the tab changed after an edit, and clean again after markSaved', async () => {
    const m = await mount({ [PATH]: CONNECTOR, 'project.json': '{"name":"p"}' });
    // opened: nothing is changed
    expect(m.dirty[0]).toBe(false);
    type(m, 'connector-description', 'changed');
    expect(m.dirty.at(-1)).toBe(true);
    m.handle().markSaved?.(PATH);
    expect(m.dirty.at(-1)).toBe(false);
  });
});
