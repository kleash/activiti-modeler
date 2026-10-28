import { describe, expect, it, vi } from 'vitest';

import { type ProjectChange, ProjectModel } from './model';

const files = [
  { path: 'project.json', content: '{}' },
  { path: 'processes/a.bpmn20.xml', content: '<a/>' },
];

describe('ProjectModel', () => {
  it('lists the saved files and rejects invalid paths', () => {
    const model = new ProjectModel(files);
    expect(model.paths()).toEqual(['processes/a.bpmn20.xml', 'project.json']);
    expect(() => new ProjectModel([{ path: '../x', content: '' }])).toThrow(/Invalid project path/);
  });

  it('tracks dirty state against the saved text', () => {
    const model = new ProjectModel(files);
    const changes: ProjectChange[] = [];
    model.onChange((c) => changes.push(c));
    model.edit('project.json', '{"a":1}');
    expect(model.isDirty('project.json')).toBe(true);
    expect(model.read('project.json')).toBe('{"a":1}');
    expect(model.saved('project.json')).toBe('{}');
    expect(model.dirtyPaths()).toEqual(['project.json']);
    // typing the saved text again is not a change
    model.edit('project.json', '{}');
    expect(model.isDirty('project.json')).toBe(false);
    expect(changes.map((c) => c.type)).toEqual(['edited', 'reverted']);
  });

  it('markSaved makes the working copy the saved text', () => {
    const model = new ProjectModel(files);
    model.edit('project.json', 'x');
    model.markSaved('project.json', 'x');
    expect(model.isDirty('project.json')).toBe(false);
    expect(model.saved('project.json')).toBe('x');
  });

  it('renames with the working copy and refuses to overwrite', () => {
    const model = new ProjectModel(files);
    model.edit('processes/a.bpmn20.xml', '<changed/>');
    model.markRenamed('processes/a.bpmn20.xml', 'processes/b.bpmn20.xml');
    expect(model.has('processes/a.bpmn20.xml')).toBe(false);
    expect(model.read('processes/b.bpmn20.xml')).toBe('<changed/>');
    expect(model.isDirty('processes/b.bpmn20.xml')).toBe(true);
    expect(() => model.markRenamed('project.json', 'processes/b.bpmn20.xml')).toThrow(/already exists/);
  });

  it('deletes and notifies', () => {
    const model = new ProjectModel(files);
    const listener = vi.fn();
    model.onChange(listener);
    const before = model.revision;
    model.markDeleted('project.json');
    expect(model.has('project.json')).toBe(false);
    expect(listener).toHaveBeenCalledWith({ type: 'deleted', path: 'project.json' });
    expect(model.revision).toBeGreaterThan(before);
  });

  it('keeps a working copy for a file that is not saved yet, without listing it', () => {
    const model = new ProjectModel(files);
    model.edit('processes/a-extensions.json', '{}');
    expect(model.isDirty('processes/a-extensions.json')).toBe(true);
    expect(model.read('processes/a-extensions.json')).toBe('{}');
    expect(model.has('processes/a-extensions.json')).toBe(false);
    expect(model.paths()).not.toContain('processes/a-extensions.json');
    model.markSaved('processes/a-extensions.json', '{}');
    expect(model.paths()).toContain('processes/a-extensions.json');
    expect(model.isDirty('processes/a-extensions.json')).toBe(false);
  });

  it('rejects invalid paths for edits', () => {
    expect(() => new ProjectModel().edit('../x.json', '')).toThrow(/Invalid project path/);
  });
});
