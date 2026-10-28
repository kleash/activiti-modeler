import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENTRY_INFO_IDS, entryInfo, GUIDE_BASE } from './entryInfo';

/** U29 / U5: the descriptions and documentation links of the create and append menus point at pages that exist. */

const GUIDE = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../docs/user-guide/properties');

describe('entry info of the create / append menus', () => {
  it('every entry has a description of Activiti behaviour', () => {
    expect(ENTRY_INFO_IDS.length).toBeGreaterThan(50);
    for (const id of ENTRY_INFO_IDS) expect(entryInfo(id)?.description.length, id).toBeGreaterThan(20);
  });

  it('every documentation link names a page of the user guide, and the page has the anchor', () => {
    let links = 0;
    for (const id of ENTRY_INFO_IDS) {
      const ref = entryInfo(id)?.documentationRef;
      if (!ref) continue;
      links += 1;
      expect(ref.startsWith(GUIDE_BASE), id).toBe(true);
      const [page, anchor] = ref.slice(GUIDE_BASE.length).split('#');
      const file = join(GUIDE, page!);
      expect(existsSync(file), `${id}: ${page}`).toBe(true);
      if (anchor) {
        const headings = readFileSync(file, 'utf8')
          .split('\n')
          // the generated pages write the engine notes as list items that hold a heading ("- ### message")
          .filter((line) => /^(- )?#{1,4} /.test(line))
          .map((line) => line.replace(/^(- )?#+ /, '').toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-'));
        expect(headings, `${id}: #${anchor} in ${page}`).toContain(anchor);
      }
    }
    expect(links).toBeGreaterThan(30);
  });

  it('an unknown entry has no info', () => {
    expect(entryInfo('no-such-entry')).toBeUndefined();
  });
});
