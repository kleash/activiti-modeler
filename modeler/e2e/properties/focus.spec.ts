import { entry, expect, openScene, panel, test, type Page } from './support';

const focusEvent = (page: Page, detail: { elementId: string; entryId?: string }): Promise<void> =>
  page.evaluate((d) => void window.dispatchEvent(new CustomEvent('activiti.lint.focus', { detail: d })), detail);

const focusedEntry = (page: Page): Promise<string | null> =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-entry-id]')?.getAttribute('data-entry-id') ?? null);

test.describe('Lint focus', () => {
  test('Lint focus: selects the element, opens its group and focuses the field of the entry', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc' });
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'user.assignee', 'ann');
    });
    await focusEvent(page, { elementId: 'u', entryId: 'user.assignee' });
    await expect(entry(page, 'user.assignee')).toBeVisible();
    await expect.poll(() => focusedEntry(page)).toBe('user.assignee');
    await expect(panel(page).locator('[data-group-id="group-userAssignment"]')).toBeVisible();
  });

  test('Lint focus: follows another element and a different group', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'serviceTask', id: 'svc', attrs: { 'activiti:class': 'org.example.Do' } });
      await a.createShape({ type: 'userTask', id: 'u' });
    }, 'u');
    await focusEvent(page, { elementId: 'svc', entryId: 'impl.class' });
    await expect.poll(() => focusedEntry(page)).toBe('impl.class');
  });

  test('Lint focus: an entry of a list item, inside a collapsed item', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.execution', [{ event: 'start', class: 'org.example.Listener' }]);
    });
    await focusEvent(page, { elementId: 'u', entryId: 'listeners.execution[0].class' });
    await expect.poll(() => focusedEntry(page)).toBe('listeners.execution[0].class');
  });

  test('Lint focus: an id that names a whole value leads to the first entry below it', async ({ page }) => {
    await openScene(page, async (a) => {
      await a.createShape({ type: 'intermediateCatchEvent', id: 'timer', eventDefinition: 'timer' });
      await a.createShape({ type: 'userTask', id: 'u' });
      await a.setProperty('u', 'listeners.task', [{ event: 'create', class: 'org.example.Listener' }]);
    });
    await focusEvent(page, { elementId: 'timer', entryId: 'timer.definition' });
    await expect.poll(() => focusedEntry(page)).toBe('timer.definition.value');
    await focusEvent(page, { elementId: 'u', entryId: 'listeners.task' });
    await expect(entry(page, 'listeners.task[0].event')).toBeAttached();
  });

  test('Lint focus: without an entry the element is only selected, and an unknown element is ignored', async ({ page }) => {
    await openScene(page, async (a) => void (await a.createShape({ type: 'userTask', id: 'u' })));
    await focusEvent(page, { elementId: 'u' });
    await expect(entry(page, 'user.assignee')).toBeAttached();
    await focusEvent(page, { elementId: 'nothing', entryId: 'user.assignee' });
    await expect(entry(page, 'user.assignee')).toBeAttached();
  });
});
