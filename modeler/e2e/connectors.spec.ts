import { expect, type Page } from '@playwright/test';

import { activePanel, dropFiles, idbFiles, menu, openApp, tab } from './support/app';
import { openProblems, problemIds } from './support/lint';
import { ModelerApi } from './support/modelerApi';
import { test } from './support/test';

/** U15: the connector catalog editor (connectors/*.json), and the element templates generated from it. */

async function newConnector(page: Page, name: string): Promise<void> {
  await menu(page, 'File', 'New file', 'Connector definition');
  await page.getByTestId('prompt-input').fill(name);
  await page.getByTestId('prompt-confirm').click();
  await expect(tab(page, `${name}.json`)).toHaveClass(/active/);
  await expect(activePanel(page).getByTestId('connector-editor')).toBeVisible();
}

const editor = (page: Page) => activePanel(page).getByTestId('connector-editor');
const field = (page: Page, id: string) => editor(page).getByTestId(id);
const problems = (page: Page) => editor(page).getByTestId('connector-problem');

async function save(page: Page): Promise<void> {
  await page.keyboard.press('Control+S');
  // the tab is clean once the files are written
  await expect(page.locator('.tab.active')).not.toHaveClass(/dirty/);
}

/** What the Activiti runtime reads (ADR 0003): the connector file holds these fields and no others. */
const RUNTIME_FIELDS = ['id', 'name', 'description', 'actions'];

const connectorFile = async (page: Page, name: string): Promise<{ name: string; actions: Record<string, { name: string; inputs: Array<Record<string, unknown>>; outputs: Array<Record<string, unknown>> }> }> => {
  const file = JSON.parse((await idbFiles(page))[`connectors/${name}.json`]!) as Record<string, unknown>;
  expect(Object.keys(file).filter((k) => !RUNTIME_FIELDS.includes(k)), `connectors/${name}.json holds fields the runtime does not read`).toEqual([]);
  return file as never;
};

/** The modeler's own data about a connector: project.json, connectors.<name> (template version, configuration). */
const connectorMeta = async (page: Page, name: string): Promise<{ version?: string; config?: unknown[] } | undefined> =>
  (JSON.parse((await idbFiles(page))['project.json']!) as { connectors?: Record<string, { version?: string; config?: unknown[] }> }).connectors?.[name];

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test.describe('U15 connector catalog editor', () => {
  test('U15 a connector definition opens in the catalog editor with its actions, inputs and outputs', async ({ page }) => {
    await newConnector(page, 'mailer');
    await expect(field(page, 'connector-name')).toHaveValue('mailer');
    await expect(field(page, 'connector-version')).toHaveValue('');
    await expect(field(page, 'action-SEND')).toBeVisible();
    await expect(field(page, 'action-SEND-call')).toHaveText('mailer.SEND');
    await expect(field(page, 'action-SEND-input-0-name')).toHaveValue('to');
    await expect(field(page, 'action-SEND-input-0-type')).toHaveValue('string');
    await expect(field(page, 'action-SEND-input-0-required')).toBeChecked();
    await expect(field(page, 'action-SEND-output-0-name')).toHaveValue('messageId');
    await expect(field(page, 'connector-status')).toHaveText('No problems');
    await expect(field(page, 'connector-template')).toHaveCount(1);
  });

  test('U15 editing an action, its typed inputs and outputs and the configuration is saved as the connector JSON', async ({ page }) => {
    await newConnector(page, 'mailer');
    await field(page, 'connector-description').fill('Sends mail and tracks it');
    await field(page, 'connector-add-action').click();
    await field(page, 'action-new1-id').fill('TRACK');
    await field(page, 'action-TRACK-name').fill('Track a message');
    await field(page, 'action-TRACK-add-input').click();
    await field(page, 'action-TRACK-input-0-name').fill('messageId');
    await field(page, 'action-TRACK-input-0-required').check();
    await field(page, 'action-TRACK-add-output').click();
    await field(page, 'action-TRACK-output-0-name').fill('delivered');
    await field(page, 'action-TRACK-output-0-type').selectOption('boolean');
    await field(page, 'action-TRACK-add-output').click();
    await field(page, 'action-TRACK-output-1-name').fill('events');
    await field(page, 'action-TRACK-output-1-type').selectOption('array');
    await field(page, 'connector-add-config').click();
    await field(page, 'connector-config-0-name').fill('host');
    await field(page, 'connector-config-0-value').fill('smtp.example.com');
    await save(page);
    const file = await connectorFile(page, 'mailer');
    expect(Object.keys(file.actions)).toEqual(['SEND', 'TRACK']);
    expect(file.actions['TRACK']).toMatchObject({
      id: 'TRACK',
      name: 'Track a message',
      inputs: [{ id: 'messageId', name: 'messageId', type: 'string', required: true }],
      outputs: [{ id: 'delivered', name: 'delivered', type: 'boolean' }, { id: 'events', name: 'events', type: 'array' }],
    });
    // the configuration is the modeler's: it is in project.json, not in the file the runtime reads
    expect((await connectorMeta(page, 'mailer'))?.config).toEqual([{ name: 'host', value: 'smtp.example.com' }]);
    expect((await idbFiles(page))['connectors/mailer.json']).toContain('"description": "Sends mail and tracks it"');
    await expect(field(page, 'connector-template')).toHaveCount(2);
    // removing an input and an action
    await field(page, 'action-TRACK-output-1-remove').click();
    await field(page, 'action-TRACK-remove').click();
    await save(page);
    expect(Object.keys((await connectorFile(page, 'mailer')).actions)).toEqual(['SEND']);
  });

  test('U15 the name must match the connector schema: lower case, digits and hyphens, at most 26 characters, no dot', async ({ page }) => {
    await newConnector(page, 'mailer');
    for (const [name, text] of [
      ['Mailer', 'lower-case'],
      ['mail.er', 'must not contain a dot'],
      ['a'.repeat(27), 'limit is 26'],
      ['-mail', 'lower-case'],
      ['', 'needs a name'],
    ] as const) {
      await field(page, 'connector-name').fill(name);
      await expect(problems(page).filter({ hasText: text }).first()).toBeVisible();
      await expect(field(page, 'connector-status')).not.toHaveText('No problems');
    }
    await field(page, 'connector-name').fill('mailer-2');
    await expect(field(page, 'connector-status')).toHaveText('No problems');
  });

  test('U15 connector names are unique in the project', async ({ page }) => {
    await newConnector(page, 'mailer');
    await save(page);
    await newConnector(page, 'second');
    await field(page, 'connector-name').fill('mailer');
    await expect(problems(page).filter({ hasText: 'already named "mailer"' })).toBeVisible();
    await field(page, 'connector-name').fill('second');
    await expect(field(page, 'connector-status')).toHaveText('No problems');
  });

  test('U15 action ids and parameter names are unique and an action id has no dot', async ({ page }) => {
    await newConnector(page, 'mailer');
    await field(page, 'connector-add-action').click();
    await field(page, 'action-new1-id').fill('SEND');
    await expect(problems(page).filter({ hasText: 'declared twice' }).first()).toBeVisible();
    await editor(page).getByTestId('action-SEND-id').last().fill('A.B');
    await expect(problems(page).filter({ hasText: 'must not contain a dot' })).toBeVisible();
    await editor(page).getByTestId('action-A.B-id').fill('SENDMORE');
    await field(page, 'action-SENDMORE-name').fill('More');
    await field(page, 'action-SENDMORE-add-input').click();
    await field(page, 'action-SENDMORE-add-input').click();
    await field(page, 'action-SENDMORE-input-0-name').fill('to');
    await field(page, 'action-SENDMORE-input-1-name').fill('to');
    await expect(problems(page).filter({ hasText: 'The input "to" is declared twice' })).toBeVisible();
    await field(page, 'action-SENDMORE-input-1-name').fill('cc');
    await expect(field(page, 'connector-status')).toHaveText('No problems');
  });

  test('U15 changing the actions without changing the version offers to bump it', async ({ page }) => {
    await newConnector(page, 'mailer');
    await field(page, 'connector-version').fill('1');
    await save(page);
    await expect(field(page, 'connector-version-note')).toHaveCount(0);
    await field(page, 'action-SEND-add-input').click();
    await field(page, 'action-SEND-input-2-name').fill('cc');
    await expect(field(page, 'connector-version-note')).toContainText('still 1');
    await field(page, 'connector-note-bump').click();
    await expect(field(page, 'connector-version')).toHaveValue('2');
    await expect(field(page, 'connector-version-note')).toHaveCount(0);
    await save(page);
    expect((await connectorMeta(page, 'mailer'))?.version).toBe('2');
    await connectorFile(page, 'mailer');
    await field(page, 'connector-bump-version').click();
    await expect(field(page, 'connector-version')).toHaveValue('3');
  });

  test('U15 the version is saved in project.json, together with the connector file, and an unsaved version is not', async ({ page }) => {
    await newConnector(page, 'mailer');
    await field(page, 'connector-version').fill('4');
    await expect(tab(page, 'mailer.json')).toHaveClass(/dirty/);
    expect(await connectorMeta(page, 'mailer')).toBeUndefined();
    await save(page);
    await expect(tab(page, 'mailer.json')).not.toHaveClass(/dirty/);
    expect(await connectorMeta(page, 'mailer')).toEqual({ version: '4' });
    await connectorFile(page, 'mailer');
    // a rename of the file takes the entry along
    await page.getByTestId('explorer').locator('[data-path="connectors/mailer.json"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    await page.getByTestId('prompt-input').fill('postman.json');
    await page.getByTestId('prompt-confirm').click();
    await expect.poll(async () => (await connectorMeta(page, 'postman'))?.version).toBe('4');
    expect(await connectorMeta(page, 'mailer')).toBeUndefined();
  });

  test('U15 a connector file that carries more than the runtime reads is cleaned when it is imported: the rest goes to project.json', async ({ page }) => {
    const descriptor = { id: 'crm', name: 'crm', version: '7', template: 't', config: [{ name: 'url', value: 'http://crm' }], actions: { LOOKUP: { id: 'LOOKUP', name: 'Look up', inputs: [{ id: 'cid', name: 'cid', type: 'string' }], outputs: [] } } };
    await dropFiles(page, [{ name: 'crm.json', content: JSON.stringify(descriptor) }]);
    await expect(editor(page)).toBeVisible();
    const file = await connectorFile(page, 'crm');
    expect(Object.keys(file)).toEqual(['id', 'name', 'actions']);
    expect(await connectorMeta(page, 'crm')).toEqual({ version: '7', template: 't', config: [{ name: 'url', value: 'http://crm' }] });
    await expect(field(page, 'connector-version')).toHaveValue('7');
    await expect(field(page, 'connector-legacy-note')).toHaveCount(0);
  });

  test('U15 a file that is not a JSON object offers the JSON editor instead', async ({ page }) => {
    await newConnector(page, 'mailer');
    await field(page, 'connector-open-json').click();
    await expect(activePanel(page).getByTestId('text-editor')).toBeVisible();
    await expect(activePanel(page)).toContainText('Open it in the connector editor');
  });
});

/** A task of the open process, selected in the panel, in a project that has the connector `mailer`. */
async function projectWithTask(page: Page): Promise<ModelerApi> {
  await newConnector(page, 'mailer');
  await field(page, 'connector-version').fill('1');
  await save(page);
  await page.getByTestId('explorer').locator('[data-path="processes/process.bpmn20.xml"]').dblclick();
  await expect(tab(page, 'process.bpmn20.xml')).toHaveClass(/active/);
  const api = await ModelerApi.attach(page);
  // the diagram reads the catalog a moment after the project changes
  await expect.poll(() => api.catalogActions()).toContain('mailer.SEND');
  await api.createShape({ type: 'serviceTask', id: 'notify', name: 'Notify' });
  await api.select('notify');
  return api;
}

const panelEntry = (page: Page, id: string) => page.locator(`#properties-panel-slot [data-entry-id="${id}"]`).first();

test.describe('U15 element templates from the catalog', () => {
  test('U15 a template applied from the chooser sets the implementation, maps the action and stores the template id and version', async ({ page }) => {
    const api = await projectWithTask(page);
    await page.getByTestId('template.info.choose').click();
    await page.locator('.djs-popup [data-id="apply-template-mailer.SEND"]').click();
    const xml = await api.currentXml();
    expect(xml).toContain('implementation="mailer.SEND"');
    expect(xml).toContain('activiti:templateId="mailer.SEND"');
    expect(xml).toContain('activiti:templateVersion="1"');
    await expect(panelEntry(page, 'template.info')).toContainText('(version 1)');
    await expect(panelEntry(page, 'mapping.inputs[0]')).toBeAttached();
  });

  test('U15 a new version of the connector marks the task outdated in the Problems panel and the panel updates it', async ({ page }) => {
    const api = await projectWithTask(page);
    await page.getByTestId('template.info.choose').click();
    await page.locator('.djs-popup [data-id="apply-template-mailer.SEND"]').click();
    await openProblems(page);
    await expect.poll(() => problemIds(page, 'processes/process.bpmn20.xml')).not.toContain('activiti/connector-template-outdated@notify');
    // the catalog editor: a new input and version 2, unsaved - the open diagram already sees it
    await page.getByTestId('explorer').locator('[data-path="connectors/mailer.json"]').dblclick();
    await field(page, 'action-SEND-add-input').click();
    await field(page, 'action-SEND-input-2-name').fill('cc');
    await field(page, 'connector-note-bump').click();
    await save(page);
    await tab(page, 'process.bpmn20.xml').click();
    await api.select('notify');
    await expect(panelEntry(page, 'template.info')).toContainText('now at version 2');
    await expect.poll(() => problemIds(page, 'processes/process.bpmn20.xml')).toContain('activiti/connector-template-outdated@notify');
    await page.getByTestId('template.info.update').click();
    await expect(panelEntry(page, 'template.info')).toContainText('(version 2)');
    expect(await api.currentXml()).toContain('activiti:templateVersion="2"');
    await expect.poll(() => problemIds(page, 'processes/process.bpmn20.xml')).not.toContain('activiti/connector-template-outdated@notify');
    // the new input is mapped
    await expect(panelEntry(page, 'mapping.inputs[2].target')).toBeAttached();
  });

  test('U15 an unsaved edit of a connector is seen by the open diagram at once', async ({ page }) => {
    const api = await projectWithTask(page);
    await page.getByTestId('explorer').locator('[data-path="connectors/mailer.json"]').dblclick();
    await field(page, 'connector-add-action').click();
    await field(page, 'action-new1-id').fill('PING');
    await field(page, 'action-PING-name').fill('Ping');
    await tab(page, 'process.bpmn20.xml').click();
    await api.select('notify');
    // the working copy reaches the catalog after a short pause
    await expect(async () => {
      await page.getByTestId('template.info.choose').click();
      await expect(page.locator('.djs-popup [data-id="apply-template-mailer.PING"]')).toBeVisible({ timeout: 1000 });
    }).toPass();
  });
});
