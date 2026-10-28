import { expect, test, type Locator, type Page } from '../support/test';
import { ModelerApi } from '../support/modelerApi';

export { expect, test };
export type { Page, Locator };
export { ModelerApi };

/** The panel's slot in the shell. */
export const panel = (page: Page): Locator => page.locator('#properties-panel-slot');

/** An entry of the panel by its entry id (the accessor key, or `<list>[<index>].<field>` inside lists). */
export const entry = (page: Page, id: string): Locator => panel(page).locator(`[data-entry-id="${id}"]`).first();

/**
 * Opens a project with one empty process `p`, lets `build` model the scene through the test API (the same accessors the panel uses),
 * and selects `select` (the process when omitted) so that the panel shows it.
 */
export async function openScene(page: Page, build: (api: ModelerApi) => Promise<void> = async () => {}, select?: string): Promise<ModelerApi> {
  const api = await ModelerApi.open(page);
  await api.createProject('panel', { defaultMappings: 'none' });
  await api.newProcess('p', 'Panel test', { file: 'p' });
  await build(api);
  await api.select(select);
  await expect(panel(page)).toBeVisible();
  return api;
}

/** The BPMN XML of the process as the export pipeline writes it (with the serializer checks). */
export async function bpmn(api: ModelerApi): Promise<string> {
  const { files } = await api.exportProject();
  const file = files.find((f) => f.path === 'processes/p.bpmn20.xml');
  if (!file) throw new Error(`no process file in ${files.map((f) => f.path).join(', ')}`);
  return file.content;
}

/** The extensions JSON of the process. */
export async function extensions(api: ModelerApi): Promise<Record<string, unknown>> {
  const { files } = await api.exportProject();
  const file = files.find((f) => f.path === 'processes/p-extensions.json');
  return file ? (JSON.parse(file.content) as Record<string, unknown>) : {};
}

// naming a shape leaves an empty BPMNLabel in the diagram after an undo; it carries no information
export const normalize = (xml: string): string => xml.replace(/<bpmndi:BPMNLabel\b[^>]*?(?:\/>|>[\s\S]*?<\/bpmndi:BPMNLabel>)/g, '').replace(/\n\s*\n/g, '\n');

/**
 * Undo restores the XML it had before the panel changed it: the panel's changes are commands of the diagram, so undoing them one
 * by one leads back to `before` (a few steps at most; the scene of the test is never undone, the loop stops at the first match).
 */
export async function expectUndoRestores(api: ModelerApi, before: string): Promise<void> {
  const wanted = normalize(before);
  for (let i = 0; i < 12 && normalize(await bpmn(api)) !== wanted; i += 1) await api.undo();
  expect(normalize(await bpmn(api))).toBe(wanted);
}

/** The extensions of process `p` (properties, mappings, constants), without the file wrapper. */
export async function processExtension(api: ModelerApi, processId = 'p'): Promise<{ properties: Record<string, Record<string, unknown>>; mappings: Record<string, Record<string, unknown>>; constants: Record<string, Record<string, { value: unknown }>> }> {
  const file = (await extensions(api)) as { extensions?: Record<string, never> };
  return (file.extensions?.[processId] ?? { properties: {}, mappings: {}, constants: {} }) as never;
}

/** The declared variables of the process as `name: type` pairs, in order. */
export async function declared(api: ModelerApi): Promise<Array<[string, unknown]>> {
  return Object.values((await processExtension(api)).properties).map((p) => [p['name'] as string, p['type']]);
}

/**
 * Undo restores the extensions JSON it had before the panel changed it (the panel's changes are commands of the diagram, so undoing them
 * one by one leads back to `before`, a few steps at most).
 */
export async function expectExtensionsUndoRestore(api: ModelerApi, before: Record<string, unknown>): Promise<void> {
  const same = async (): Promise<boolean> => JSON.stringify(await extensions(api)) === JSON.stringify(before);
  for (let i = 0; i < 12 && !(await same()); i += 1) await api.undo();
  expect(await extensions(api)).toEqual(before);
}

/** Clicks a button inside an entry (move, remove) after opening what hides it. */
export async function clickIn(page: Page, id: string, button: string | RegExp): Promise<void> {
  const target = await reveal(page, id);
  // the delete button of a list item shows when the header is hovered
  await target.hover();
  await target.getByRole('button', { name: button }).click();
}

/**
 * Opens the groups (and list items) around an entry the way a user does, by clicking their headers, so that the entry is visible.
 * Groups the panel keeps open need no click.
 */
export async function reveal(page: Page, id: string): Promise<Locator> {
  const target = entry(page, id);
  await target.waitFor({ state: 'attached' });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await target.isVisible()) return target;
    // opens the closest closed item or group around the entry; returns the element that is marked `open` once it is open
    const opening = await target.evaluateHandle((node) => {
      const item = node.closest('.bio-properties-panel-collapsible-entry:not(.open)');
      if (item) {
        (item.querySelector('.bio-properties-panel-collapsible-entry-header') as HTMLElement).click();
        return item;
      }
      const group = node.closest('.bio-properties-panel-group');
      const header = group?.querySelector('.bio-properties-panel-group-header') as HTMLElement | null;
      const open = group?.querySelector('.bio-properties-panel-group-entries.open, .bio-properties-panel-list.open');
      if (group && header && !open) {
        header.click();
        return group.querySelector('.bio-properties-panel-group-entries, .bio-properties-panel-list');
      }
      return null;
    });
    const marked = opening.asElement();
    if (!marked) break;
    // a second click before the panel has drawn the open state would close it again
    await expect.poll(() => marked.evaluate((el) => el.classList.contains('open'))).toBe(true);
  }
  await expect(target).toBeVisible();
  return target;
}

/**
 * Waits until the entry has its control and returns the entry. An expression entry is drawn first and gets its CodeMirror editor
 * a moment later (the editor is created in an effect after the entry is on the page), so an entry that is visible does not yet say
 * whether it is an editor or an input: looking at once picks the wrong one on a busy machine.
 */
async function ready(page: Page, id: string): Promise<Locator> {
  const target = await reveal(page, id);
  await target.locator('.cm-content, select, input:not([type=checkbox]), textarea').first().waitFor({ state: 'attached' });
  return target;
}

/** Replaces the text of an entry: a text field, a text area or an expression editor, and leaves the field so that the value is written. */
export async function type(page: Page, id: string, text: string): Promise<void> {
  const target = await ready(page, id);
  const editor = target.locator('.cm-content');
  if (await editor.count()) {
    await editor.click();
    await page.keyboard.press('Control+A');
    if (text === '') await page.keyboard.press('Delete');
    else await page.keyboard.insertText(text);
  } else {
    await target.locator('input:not([type=checkbox]), textarea').first().fill(text);
  }
  await page.keyboard.press('Tab');
}

/** Chooses an option of a select entry by its value. */
export async function pick(page: Page, id: string, value: string): Promise<void> {
  const target = await reveal(page, id);
  await target.locator('select').first().selectOption(value);
}

/** Sets a checkbox entry. */
export async function check(page: Page, id: string, checked = true): Promise<void> {
  const target = await reveal(page, id);
  await target.locator('input[type=checkbox]').setChecked(checked);
}

/** The text shown in an entry's field (input, text area or editor). */
export async function valueOf(page: Page, id: string): Promise<string> {
  const target = await ready(page, id);
  const editor = target.locator('.cm-content');
  if (await editor.count()) return (await editor.innerText()).replace(/\n$/, '');
  const select = target.locator('select').first();
  if (await select.count()) return select.inputValue();
  return target.locator('input:not([type=checkbox]), textarea').first().inputValue();
}

/** The message (error, warning or hint) shown under an entry. */
export const messageOf = (page: Page, id: string): Locator => entry(page, id).locator('.bio-properties-panel-diagnostic-message').first();

/** Clicks the "Add" button of a list group (`messages`, `executionListeners`, ...). */
export async function addListItem(page: Page, groupId: string): Promise<void> {
  await panel(page).locator(`[data-group-id="group-${groupId}"] .bio-properties-panel-add-entry`).click();
}

/** Clicks the add button of a rows entry (fields, parameters, ...). */
export async function addRow(page: Page, id: string): Promise<void> {
  await reveal(page, id);
  await panel(page).locator(`[data-testid="${id}-add"]`).click();
}

/** The groups the panel shows, by id. */
export async function groupIds(page: Page): Promise<string[]> {
  return panel(page).locator('[data-group-id]').evaluateAll((nodes) => nodes.map((n) => (n.getAttribute('data-group-id') ?? '').replace(/^group-/, '')));
}

// --- table-driven cases ------------------------------------------------------------------------------------------------------------

export type Scene = (api: ModelerApi) => Promise<void>;
type Pattern = string | RegExp;

export function expectXml(xml: string, patterns: Pattern[] = [], absent: Pattern[] = []): void {
  for (const p of patterns) {
    if (typeof p === 'string') expect(xml, `the XML contains ${p}`).toContain(p);
    else expect(xml, `the XML matches ${String(p)}`).toMatch(p);
  }
  for (const p of absent) {
    if (typeof p === 'string') expect(xml, `the XML does not contain ${p}`).not.toContain(p);
    else expect(xml, `the XML does not match ${String(p)}`).not.toMatch(p);
  }
}

export interface Case {
  /** Starts with the group name, e.g. `User assignment: assignee`. */
  title: string;
  scene: Scene;
  /** The element to select (the process when omitted). */
  select?: string;
  /** Entry id. */
  id: string;
  xml: Pattern[];
  notXml?: Pattern[];
  /** More to do after the panel wrote the value (checks of the extensions JSON or of the panel). */
  after?: (api: ModelerApi, page: Page) => Promise<void>;
}

/** Types a text into an entry, checks the exported XML and that one undo restores the XML. */
export function typeCase(c: Case & { value: string }): void {
  test(c.title, async ({ page }) => {
    const api = await openScene(page, c.scene, c.select);
    const before = await bpmn(api);
    await type(page, c.id, c.value);
    expectXml(await bpmn(api), c.xml, c.notXml);
    await c.after?.(api, page);
    await expectUndoRestores(api, before);
  });
}

/** Chooses an option of a select entry. */
export function pickCase(c: Case & { value: string }): void {
  test(c.title, async ({ page }) => {
    const api = await openScene(page, c.scene, c.select);
    const before = await bpmn(api);
    await pick(page, c.id, c.value);
    expectXml(await bpmn(api), c.xml, c.notXml);
    await c.after?.(api, page);
    await expectUndoRestores(api, before);
  });
}

/** Switches a checkbox entry. */
export function checkCase(c: Case & { checked?: boolean }): void {
  test(c.title, async ({ page }) => {
    const api = await openScene(page, c.scene, c.select);
    const before = await bpmn(api);
    await check(page, c.id, c.checked ?? true);
    expectXml(await bpmn(api), c.xml, c.notXml);
    await c.after?.(api, page);
    await expectUndoRestores(api, before);
  });
}

/** The scene helpers: one element of a kind with its id. */
export const userTask: Scene = async (a) => void (await a.createShape({ type: 'userTask', id: 'u' }));
export const serviceTask: Scene = async (a) => void (await a.createShape({ type: 'serviceTask', id: 'svc' }));

// --- the project's connectors and decisions ----------------------------------------------------------------------------------------

/** The connector of the C02 seed: `crm.LOOKUP` takes a customerId and returns the customer's name, tier and whether it was found. */
export const CRM_CONNECTOR = JSON.stringify({
  id: 'crm',
  name: 'crm',
  description: 'Customer lookups',
  version: '1',
  actions: {
    LOOKUP: {
      id: 'LOOKUP',
      name: 'Look up a customer',
      description: 'Finds a customer by id',
      inputs: [{ id: 'customerId', name: 'customerId', type: 'string', required: true }],
      outputs: [
        { id: 'customerName', name: 'customerName', type: 'string' },
        { id: 'tier', name: 'tier', type: 'string' },
        { id: 'found', name: 'found', type: 'boolean' },
      ],
    },
    DELETE: { id: 'DELETE', name: 'Delete a customer', inputs: [{ id: 'customerId', name: 'customerId', type: 'string', required: true }], outputs: [] },
  },
});

/** A DMN decision table `riskLevel` (UNIQUE) reading `age` and `region` and returning the output columns `level` and `reason`. */
export const RISK_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="risk" name="Risk" namespace="http://example.com/risk">
  <decision id="riskLevel" name="Risk level">
    <variable id="riskLevel_v" name="riskLevel"/>
    <decisionTable id="t1" hitPolicy="UNIQUE">
      <input id="i1" label="Age"><inputExpression id="ie1" typeRef="integer"><text>age</text></inputExpression></input>
      <input id="i2" label="Region"><inputExpression id="ie2" typeRef="string"><text>region</text></inputExpression></input>
      <output id="o1" name="level" typeRef="string"/>
      <output id="o2" name="points" typeRef="integer"/>
      <rule id="r1"><inputEntry id="r1i1"><text>&lt; 18</text></inputEntry><inputEntry id="r1i2"><text>-</text></inputEntry><outputEntry id="r1o1"><text>"low"</text></outputEntry><outputEntry id="r1o2"><text>1</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>
`;

/** A COLLECT table without an aggregator: its result is a list of rows under the decision id. */
export const BADGES_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="badges" name="Badges" namespace="http://example.com/badges">
  <decision id="badges" name="Badges">
    <variable id="badges_v" name="badges"/>
    <decisionTable id="bt" hitPolicy="COLLECT">
      <input id="bi1"><inputExpression id="bie1" typeRef="integer"><text>points</text></inputExpression></input>
      <output id="bo1" name="badge" typeRef="string"/>
      <rule id="br1"><inputEntry id="br1i1"><text>&gt; 1</text></inputEntry><outputEntry id="br1o1"><text>"star"</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>
`;

export const connectorTask: Scene = async (a) => {
  await a.addConnector('crm', CRM_CONNECTOR);
  await a.createShape({ type: 'serviceTask', id: 'svc', name: 'Look up', attrs: { implementation: 'crm.LOOKUP' } });
};

/** The suggestions of a text cell (its datalist). */
export async function suggestionsOf(page: Page, cellId: string): Promise<string[]> {
  return panel(page).locator(`datalist[data-suggestions-for="${cellId}"] option`).evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
}
