import type { TemplateInfo } from '@activiti-modeler/bpmn-js-activiti';

import { group, type Definition, type EntryBuilder } from '../builders';

/** The template header of a task: the template it was created from (Update, Unlink) or the way to apply one. */
export function templateGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'template.info')) return [];
  const info = env.get<TemplateInfo | undefined>(element, 'template.info');
  const choose = (): void => void env.eventBus.fire('elementTemplates.select', { element });
  const unlink = (): void => void env.write(element, 'template.unlink', true, 'template.info');
  const update = (): void => void env.write(element, 'template.update', true, 'template.info');
  let entry: Definition;
  if (!info) {
    entry = b.action({
      id: 'template.info',
      text: 'This task was not created from a template. A template sets the implementation, maps the inputs and outputs of a connector action and declares the variables it returns.',
      buttons: [{ id: 'choose', label: 'Apply template…', run: choose }],
      docs: 'template.info',
    });
  } else if (info.state === 'unknown') {
    entry = b.action({
      id: 'template.info',
      severity: 'warning',
      text: `Created from the template ${info.id} (version ${info.version}), which the project no longer defines: its connector or action is not in connectors/.`,
      buttons: [{ id: 'unlink', label: 'Unlink', run: unlink }],
      docs: 'template.info',
    });
  } else if (info.state === 'outdated') {
    entry = b.action({
      id: 'template.info',
      severity: 'warning',
      text: `Created from ${info.name ?? info.id} version ${info.version}; the template is now at version ${info.latestVersion}. Update adds the inputs and outputs the new version has and keeps your mapping rows.`,
      buttons: [
        { id: 'update', label: `Update to version ${info.latestVersion}`, run: update },
        { id: 'unlink', label: 'Unlink', run: unlink },
      ],
      docs: 'template.info',
    });
  } else {
    entry = b.action({
      id: 'template.info',
      text: `Created from the template ${info.name ?? info.id} (version ${info.version}).`,
      buttons: [
        { id: 'choose', label: 'Apply another template…', run: choose },
        { id: 'unlink', label: 'Unlink', title: 'Keep the task as it is and forget the template', run: unlink },
      ],
      docs: 'template.info',
    });
  }
  return [group({ id: 'template', label: 'Template', entries: [entry], shouldOpen: true })];
}
