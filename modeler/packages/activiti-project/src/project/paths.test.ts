import { describe, expect, it } from 'vitest';

import { basename, buildTree, comparePaths, dirname, joinPath, pathProblem, splitName, uniquePath } from './paths';

describe('pathProblem', () => {
  it.each(['project.json', 'processes/a.bpmn20.xml', 'a/b/c/d.json', 'processes/a b.json', 'Ünï/ç.dmn'])('accepts %s', (path) => {
    expect(pathProblem(path)).toBeUndefined();
  });

  it.each([
    ['', 'empty'],
    ['/abs.json', 'relative'],
    ['dir/', 'file'],
    ['a\\b.json', 'separator'],
    ['../x.json', '".."'],
    ['a/./b.json', '"."'],
    ['a//b.json', 'empty folder'],
    ['a/b?.json', 'not allowed'],
    ['trailing.', 'dot'],
    ['name /x.json', 'space'],
  ])('rejects %j (%s)', (path, fragment) => {
    expect(pathProblem(path)).toContain(fragment);
  });
});

describe('path helpers', () => {
  it('splits and joins', () => {
    expect(basename('a/b/c.json')).toBe('c.json');
    expect(dirname('a/b/c.json')).toBe('a/b');
    expect(dirname('c.json')).toBe('');
    expect(joinPath('', 'a', '', 'b')).toBe('a/b');
  });

  it('keeps multi part suffixes together', () => {
    expect(splitName('loan.bpmn20.xml')).toEqual({ stem: 'loan', suffix: '.bpmn20.xml' });
    expect(splitName('loan-extensions.json')).toEqual({ stem: 'loan', suffix: '-extensions.json' });
    expect(splitName('a.scenario.json')).toEqual({ stem: 'a', suffix: '.scenario.json' });
    expect(splitName('risk.dmn')).toEqual({ stem: 'risk', suffix: '.dmn' });
    expect(splitName('README')).toEqual({ stem: 'README', suffix: '' });
  });

  it('finds a free name', () => {
    const taken = new Set(['processes/a.bpmn20.xml', 'processes/a-2.bpmn20.xml']);
    expect(uniquePath('processes/a.bpmn20.xml', (p) => taken.has(p))).toBe('processes/a-3.bpmn20.xml');
    expect(uniquePath('processes/b.bpmn20.xml', (p) => taken.has(p))).toBe('processes/b.bpmn20.xml');
  });

  it('sorts folders before files, then by name', () => {
    expect(['b.json', 'processes/z.dmn', 'a.json', 'connectors/x.json', 'processes/a.dmn'].sort(comparePaths)).toEqual([
      'connectors/x.json',
      'processes/a.dmn',
      'processes/z.dmn',
      'a.json',
      'b.json',
    ]);
  });
});

describe('buildTree', () => {
  it('nests folders and lists files', () => {
    const tree = buildTree(['project.json', 'processes/a.bpmn20.xml', 'processes/a-extensions.json', 'connectors/m.json']);
    expect(tree.map((n) => `${n.type}:${n.path}`)).toEqual(['folder:connectors', 'folder:processes', 'file:project.json']);
    expect(tree[1]!.children.map((n) => n.path)).toEqual(['processes/a-extensions.json', 'processes/a.bpmn20.xml']);
  });
});
