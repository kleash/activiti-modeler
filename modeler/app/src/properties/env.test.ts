import type { ElementRegistry, ExtensionsStore, ProjectCatalog, PropertyAccessors } from '@activiti-modeler/bpmn-js-activiti';
import { AccessorError } from '@activiti-modeler/bpmn-js-activiti';
import { describe, expect, it } from 'vitest';

import { PanelEnv } from './env';
import { error, info, warning } from './validation/types';

/** The refused-text guard of the text fields (`PanelEnv.typing`) and the refused writes of the accessors. */

type Event = { type: string; data?: Record<string, unknown> };

function makeEnv(setImpl: (key: string, value: unknown) => void = () => undefined): { env: PanelEnv; events: Event[]; writes: Array<[string, unknown]> } {
  const events: Event[] = [];
  const writes: Array<[string, unknown]> = [];
  const accessors = {
    set: (_element: unknown, key: string, value: unknown) => {
      setImpl(key, value);
      writes.push([key, value]);
    },
    get: () => undefined,
    has: () => true,
  } as unknown as PropertyAccessors;
  const env = new PanelEnv(
    accessors,
    {} as ElementRegistry,
    {} as ExtensionsStore,
    { fire: (type, data) => void events.push({ type, ...(data ? { data } : {}) }), on: () => undefined },
    ((fn: unknown) => fn) as never,
    {} as ProjectCatalog,
  );
  return { env, events, writes };
}

const element = (id: string) => ({ id }) as never;
const blur = (value: string) => ({ target: { value } }) as unknown as FocusEvent;
const refreshes = (events: Event[]): number => events.filter((e) => e.type === 'propertiesPanel.providersChanged').length;

describe('PanelEnv.typing: the text that was refused stays in the field and keeps its message', () => {
  it('refuses the text of a field whose diagnostic is an error (or a plain message) and records it; warnings and infos do not block', () => {
    const { env } = makeEnv();
    const guard = env.typing(element('task'), 'impl.class', 'com.Old');
    expect(guard.refuses('bad name', error('Not a class name'))).toBe(true);
    expect(guard.refuses('bad name', 'a plain message')).toBe(true);
    expect(guard.refuses('fine', warning('Hmm'))).toBe(false);
    expect(guard.refuses('fine', info('Note'))).toBe(false);
    expect(guard.refuses('fine', null)).toBe(false);
    expect(guard.refuses(undefined, undefined)).toBe(false);
  });

  it('the validator checks the refused text in place of the model value while the field still holds the model value', () => {
    const { env } = makeEnv();
    const check = (value: string | undefined): string => `checked:${value ?? 'none'}`;
    // the entry is built again (a lint result) with the committed value of the model
    const first = env.typing(element('task'), 'impl.class', 'com.Old');
    expect(first.validator(check)('com.Old')).toBe('checked:com.Old');
    first.refuses('not a class', error('Not a class name'));
    const rebuilt = env.typing(element('task'), 'impl.class', 'com.Old');
    // the field shows the committed text again after the rebuild, the guard checks what was typed
    expect(rebuilt.validator(check)('com.Old')).toBe('checked:not a class');
  });

  it('the validator checks what the field holds once it holds something else, and once the model changed', () => {
    const { env } = makeEnv();
    const check = (value: string | undefined): string => `checked:${value ?? 'none'}`;
    env.typing(element('task'), 'impl.class', 'com.Old').refuses('not a class', error('x'));
    expect(env.typing(element('task'), 'impl.class', 'com.Old').validator(check)('typing on')).toBe('checked:typing on');
    // the model got another value (an undo, a change elsewhere): the refused text is stale
    expect(env.typing(element('task'), 'impl.class', 'com.New').validator(check)('com.New')).toBe('checked:com.New');
    // a field that was empty in the model
    env.typing(element('task'), 'impl.expression', undefined).refuses('${', error('x'));
    expect(env.typing(element('task'), 'impl.expression', undefined).validator(check)(undefined)).toBe('checked:${');
  });

  it('a later accepted text drops the refused one', () => {
    const { env } = makeEnv();
    const check = (value: string | undefined): string => `checked:${value ?? 'none'}`;
    const guard = env.typing(element('task'), 'impl.class', 'com.Old');
    guard.refuses('bad', error('x'));
    guard.refuses('good', null);
    expect(env.typing(element('task'), 'impl.class', 'com.Old').validator(check)('com.Old')).toBe('checked:com.Old');
  });

  it('the guard is per element and per entry', () => {
    const { env } = makeEnv();
    const check = (value: string | undefined): string => `checked:${value ?? 'none'}`;
    env.typing(element('a'), 'impl.class', 'x').refuses('bad', error('x'));
    expect(env.typing(element('b'), 'impl.class', 'x').validator(check)('x')).toBe('checked:x');
    expect(env.typing(element('a'), 'impl.expression', 'x').validator(check)('x')).toBe('checked:x');
    expect(env.typing(element('a'), 'impl.class', 'x').validator(check)('x')).toBe('checked:bad');
  });

  it('leaving the field with the model value drops the refused text and builds the panel again; leaving it with other text keeps it', () => {
    const { env, events } = makeEnv();
    const guard = env.typing(element('task'), 'impl.class', 'com.Old');
    guard.refuses('bad', error('x'));
    guard.onBlur(blur('still typing'));
    expect(refreshes(events)).toBe(0);
    expect(env.typing(element('task'), 'impl.class', 'com.Old').validator((v) => v)('com.Old')).toBe('bad');
    guard.onBlur(blur('  com.Old  '));
    expect(refreshes(events)).toBe(1);
    expect(env.typing(element('task'), 'impl.class', 'com.Old').validator((v) => v)('com.Old')).toBe('com.Old');
  });

  it('a blur of a field that was never refused does nothing; an empty model value matches an empty field', () => {
    const { env, events } = makeEnv();
    env.typing(element('task'), 'impl.class', 'x').onBlur(blur('anything'));
    expect(refreshes(events)).toBe(0);
    const guard = env.typing(element('task'), 'impl.expression', undefined);
    guard.refuses('${', error('x'));
    guard.onBlur(blur(''));
    expect(refreshes(events)).toBe(1);
  });

  it('selecting another element forgets every refused text', () => {
    const { env } = makeEnv();
    env.typing(element('a'), 'impl.class', 'x').refuses('bad', error('x'));
    env.typing(element('b'), 'impl.class', 'y').refuses('bad too', error('x'));
    env.forgetTyping();
    expect(env.typing(element('a'), 'impl.class', 'x').validator((v) => v)('x')).toBe('x');
    expect(env.typing(element('b'), 'impl.class', 'y').validator((v) => v)('y')).toBe('y');
  });
});

describe('PanelEnv.choosing: the choice of a select that was refused keeps its message when the panel is built again', () => {
  const check = (value: string | undefined): string => `checked:${value === '' ? 'none' : (value ?? 'none')}`;

  it('the validator checks the refused choice in place of the model value, until the model changes or another element is selected', () => {
    const { env } = makeEnv();
    const guard = env.choosing(element('task'), 'listeners[0].onTransaction', '');
    expect(guard.refuses('committed', error('cannot be an expression'))).toBe(true);
    // a lint result builds the entry again: the library validates the value of the model
    expect(env.choosing(element('task'), 'listeners[0].onTransaction', '').validator(check)('')).toBe('checked:committed');
    // the model changed (a command): the choice is stale
    env.forgetChoices();
    expect(env.choosing(element('task'), 'listeners[0].onTransaction', '').validator(check)('')).toBe('checked:none');
  });

  it('a choice that is accepted, a value of the model that differs, or another entry or element are not affected', () => {
    const { env } = makeEnv();
    env.choosing(element('a'), 'x', '').refuses('bad', error('x'));
    expect(env.choosing(element('b'), 'x', '').validator(check)('')).toBe('checked:none');
    expect(env.choosing(element('a'), 'y', '').validator(check)('')).toBe('checked:none');
    expect(env.choosing(element('a'), 'x', 'other').validator(check)('other')).toBe('checked:other');
    expect(env.choosing(element('a'), 'x', '').refuses('fine', warning('hmm'))).toBe(false);
    expect(env.choosing(element('a'), 'x', '').validator(check)('')).toBe('checked:none');
  });
});

describe('PanelEnv.write: a value the accessor refuses is not written and its message goes under the field', () => {
  it('writes through the accessor and clears an earlier message of the entry', () => {
    let refuse = true;
    const { env, events, writes } = makeEnv(() => {
      if (refuse) throw new AccessorError('too-long', 'general.name', 'Too long');
    });
    expect(env.write(element('task'), 'general.name', 'x'.repeat(300), 'name-entry')).toBe(false);
    expect(writes).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'propertiesPanel.setDiagnostics', data: { diagnostics: { 'name-entry': [{ message: 'Too long', severity: 'error' }] } } });
    refuse = false;
    expect(env.write(element('task'), 'general.name', 'ok', 'name-entry')).toBe(true);
    expect(writes).toEqual([['general.name', 'ok']]);
    expect(events.at(-1)).toEqual({ type: 'propertiesPanel.setDiagnostics', data: { diagnostics: {} } });
  });

  it('rethrows what is not an accessor refusal', () => {
    const { env } = makeEnv(() => {
      throw new TypeError('broken');
    });
    expect(() => env.write(element('task'), 'k', 'v')).toThrow('broken');
  });

  it('forget() without an entry drops every message', () => {
    const { env, events } = makeEnv(() => {
      throw new AccessorError('no', 'k', 'no');
    });
    env.write(element('a'), 'k', 'v', 'one');
    env.write(element('a'), 'k', 'v', 'two');
    env.forget();
    expect(events.at(-1)).toEqual({ type: 'propertiesPanel.setDiagnostics', data: { diagnostics: {} } });
  });
});
