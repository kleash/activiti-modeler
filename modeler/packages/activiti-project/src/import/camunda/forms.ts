import { ACTIVITI_NS, CAMUNDA_NS } from './detect';
import type { ReportKind } from './types';

export interface FormNote {
  kind: ReportKind;
  item: string;
  what: string;
  why: string;
}

const FORM_TYPES = new Set(['string', 'long', 'boolean', 'date', 'enum']);
const camundaChildren = (el: Element, local: string): Element[] => Array.from(el.children).filter((c) => c.namespaceURI === CAMUNDA_NS && c.localName === local);

/**
 * `<camunda:formData>` (the generated form of a task or start event) as `<activiti:formProperty>` elements. Activiti keeps form properties in
 * the model and the application may read them, but nothing in Activiti 9 shows or checks them.
 */
export function buildFormProperties(ctx: { doc: Document }, formData: Element): { elements: Element[]; notes: FormNote[] } {
  const elements: Element[] = [];
  const notes: FormNote[] = [];
  const fields = camundaChildren(formData, 'formField');
  for (const field of fields) {
    const id = field.getAttribute('id') ?? '';
    const out = ctx.doc.createElementNS(ACTIVITI_NS, 'activiti:formProperty');
    out.setAttribute('id', id);
    const label = field.getAttribute('label');
    if (label) out.setAttribute('name', label);
    const type = field.getAttribute('type') ?? 'string';
    if (FORM_TYPES.has(type)) out.setAttribute('type', type);
    else {
      out.setAttribute('type', 'string');
      notes.push({ kind: 'approximated', item: `formField ${id} type="${type}"`, what: 'converted to the type string', why: 'Activiti knows the form types string, long, boolean, date and enum' });
    }
    const def = field.getAttribute('defaultValue');
    if (def !== null) out.setAttribute('default', def);
    for (const validation of camundaChildren(field, 'validation')) {
      for (const constraint of camundaChildren(validation, 'constraint')) {
        const name = constraint.getAttribute('name') ?? '';
        if (name === 'required') out.setAttribute('required', 'true');
        else if (name === 'readonly') out.setAttribute('writable', 'false');
        else {
          const config = constraint.getAttribute('config');
          notes.push({ kind: 'dropped', item: `formField ${id} constraint ${name}${config ? `="${config}"` : ''}`, what: 'dropped', why: 'Activiti does not validate form values' });
        }
      }
    }
    for (const value of camundaChildren(field, 'value')) {
      const v = ctx.doc.createElementNS(ACTIVITI_NS, 'activiti:value');
      v.setAttribute('id', value.getAttribute('id') ?? '');
      const name = value.getAttribute('name');
      if (name !== null) v.setAttribute('name', name);
      out.appendChild(v);
    }
    if (camundaChildren(field, 'properties').length > 0) {
      notes.push({ kind: 'dropped', item: `formField ${id} properties`, what: 'dropped', why: 'Camunda extension properties have no meaning to Activiti' });
    }
    elements.push(out);
  }
  if (fields.length > 0) {
    notes.unshift({
      kind: 'approximated',
      item: `formData (${fields.length} field${fields.length === 1 ? '' : 's'})`,
      what: 'converted to activiti:formProperty',
      why: 'Activiti 9 keeps form properties in the model but shows and checks nothing; use activiti:formKey and a form in your application',
    });
  }
  return { elements, notes };
}
