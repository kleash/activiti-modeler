import { type Diagnostic, error } from './types';

/** The same rule as the `general.id` accessor: an XML NCName of at most 255 characters. */
const NCNAME = /^[\p{L}_][\p{L}\p{N}._\-·]*$/u;

export function idProblem(id: string): Diagnostic | undefined {
  if (id === '') return error('An id is required.');
  if (/\s/.test(id)) return error('An id cannot contain spaces. Use letters, digits, "_", "-" and ".".');
  if (id.includes(':')) return error('An id cannot contain a colon.');
  if (/^[\p{N}\-.]/u.test(id)) return error('An id must start with a letter or an underscore.');
  if (!NCNAME.test(id)) return error('An id may contain only letters, digits, "_", "-" and ".".');
  if (id.length > 255) return error(`An id has at most 255 characters (this one has ${id.length}).`);
  return undefined;
}

/** A Java class name as `activiti:class` expects it (fully qualified, no expression). */
export function classNameProblem(value: string): Diagnostic | undefined {
  if (value === '') return undefined;
  if (/[$#]\{/.test(value)) return error('A Java class is a fully qualified class name; use "Expression" or "Delegate expression" for ${...}.');
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value)) return error('Enter a fully qualified Java class name such as com.example.MyDelegate.');
  return undefined;
}

/** A process variable name as Activiti stores it (and JUEL reads it): a Java identifier. */
export function variableNameProblem(value: string): Diagnostic | undefined {
  if (value === '') return undefined;
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) return error('A variable name is a plain identifier (letters, digits, "_" and "$"), so that ${name} can read it.');
  return undefined;
}
