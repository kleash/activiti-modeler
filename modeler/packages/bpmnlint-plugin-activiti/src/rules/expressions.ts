/** L27 (malformed JUEL), the string `+` trap (engine finding 36) and L28 (timer values). */
import { checkJuel } from '../juel';
import { defineRule } from '../define';
import { child, expressionText, fieldsOf, is, isBlank, label, str } from '../model';
import { END_DATE_ISSUE, parseDateTime, timeCycleIssue, timeDateIssue, timeDurationIssue } from '../timer';
import type { ME } from '../types';

export interface ExpressionSite {
  what: string;
  text: string;
  entry?: string;
  /** false when a ProcessValidator mirror already checks the syntax (conditions). */
  syntax: boolean;
}

const attr = (node: ME, name: string): string | undefined => str(node, name);

/** Every expression-valued attribute and element text of a node (not of its children: the walker visits those itself). */
export function expressionSites(node: ME): ExpressionSite[] {
  const out: ExpressionSite[] = [];
  const add = (what: string, text: string | undefined, entry?: string, syntax = true): void => {
    if (text !== undefined && text.trim() !== '') out.push({ what, text, ...(entry ? { entry } : {}), syntax });
  };
  const attrs = (names: string[], prefix = 'activiti:'): void => names.forEach((n) => add(`${prefix}${n}`, attr(node, `${prefix}${n}`)));

  if (is(node, 'bpmn:Process')) attrs(['candidateStarterUsers', 'candidateStarterGroups']);
  if (is(node, 'bpmn:UserTask')) {
    attrs(['assignee', 'owner', 'candidateUsers', 'candidateGroups', 'dueDate', 'priority', 'category', 'formKey']);
    add('activiti:skipExpression', attr(node, 'activiti:skipExpression'), 'skip.expression');
  }
  if (is(node, 'bpmn:ServiceTask')) {
    add('activiti:expression', attr(node, 'activiti:expression'), 'impl.expression');
    add('activiti:delegateExpression', attr(node, 'activiti:delegateExpression'), 'impl.delegateExpression');
    add('activiti:skipExpression', attr(node, 'activiti:skipExpression'), 'skip.expression');
  }
  if (is(node, 'bpmn:ScriptTask')) {
    const format = (str(node, 'scriptFormat') ?? 'juel').toLowerCase();
    const script = node.get('script');
    if (format === 'juel' && typeof script === 'string') add('the script (JUEL)', script, 'script.text');
  }
  if (is(node, 'bpmn:CallActivity')) {
    add('calledElement', attr(node, 'calledElement'), undefined);
    add('activiti:businessKey', attr(node, 'activiti:businessKey'));
  }
  if (is(node, 'bpmn:SequenceFlow')) {
    add('activiti:skipExpression', attr(node, 'activiti:skipExpression'), 'skip.expression');
    add('the condition', expressionText(child(node, 'conditionExpression')), 'flow.condition', false);
  }
  if (is(node, 'bpmn:StartEvent')) add('activiti:formKey', attr(node, 'activiti:formKey'));
  if (is(node, 'bpmn:MultiInstanceLoopCharacteristics')) {
    add('the loop cardinality', expressionText(child(node, 'loopCardinality')), 'mi.type');
    add('the completion condition', expressionText(child(node, 'completionCondition')), 'mi.type');
    const collection = attr(node, 'activiti:collection');
    if (collection?.includes('{')) add('activiti:collection', collection, 'mi.type');
  }
  if (is(node, 'bpmn:MessageEventDefinition')) {
    add('activiti:messageExpression', attr(node, 'activiti:messageExpression'), 'event.definition');
    add('activiti:correlationKey', attr(node, 'activiti:correlationKey'), 'event.definition');
  }
  if (is(node, 'bpmn:SignalEventDefinition')) add('activiti:signalExpression', attr(node, 'activiti:signalExpression'), 'event.definition');
  if (is(node, 'bpmn:TimerEventDefinition')) {
    for (const p of ['timeDate', 'timeDuration', 'timeCycle']) add(`the timer ${p}`, expressionText(child(node, p)), 'timer.definition');
    const cycle = child(node, 'timeCycle');
    if (cycle) add('the timer end date', attr(cycle, 'activiti:endDate'), 'timer.definition');
  }
  if (node.$type === 'activiti:ExecutionListener' || node.$type === 'activiti:TaskListener') {
    for (const n of ['expression', 'delegateExpression', 'customPropertiesResolverExpression', 'customPropertiesResolverDelegateExpression']) add(`the listener ${n}`, attr(node, n), 'listeners.event');
  }
  if (node.$type === 'activiti:EventListener') add('the event listener delegateExpression', attr(node, 'delegateExpression'), 'listeners.event');
  if (node.$type === 'activiti:In' || node.$type === 'activiti:Out') add(`${node.$type === 'activiti:In' ? 'in' : 'out'} sourceExpression`, attr(node, 'sourceExpression'));
  if (is(node, 'bpmn:ServiceTask') || is(node, 'bpmn:SendTask') || is(node, 'bpmn:MessageEventDefinition')) {
    for (const f of fieldsOf(node)) if (f.isExpression) add(`field ${f.name}`, f.value, 'fields.list');
  }
  return out;
}

export const expressionRules = [
  defineRule({
    id: 'invalid-juel-expression',
    tag: 'L27',
    severity: 'error',
    title: 'An expression that is not valid JUEL',
    why: 'Every expression attribute (assignee, due date, skip expression, delegate expression, called element, multi-instance cardinality and completion condition, message and signal expressions, timers, field expressions, listeners) is parsed by the JUEL expression factory when it is used, and a malformed one fails at that moment, not at deployment. The most frequent mistakes: `${` without `}`, `=` for comparison or assignment (`${x = 5}` is a parse error), and `;`. Conditions of sequence flows are checked by `seq-flow-invalid-conditional-expression`.',
    evidence: ['R1 §8.1', 'R1 §7.1 L27', 'engine-findings 25 (EL 2.2)'],
    howToFix: 'Fix the expression in the field named in the message.',
    check: (node, api) => {
      for (const site of expressionSites(node)) {
        if (!site.syntax) continue;
        const result = checkJuel(site.text);
        if (result.issues.length > 0) api.report(node, `${site.what} of ${label(node)}: ${result.issues[0]!.message}`, site.entry ? { entryId: site.entry } : {});
      }
    },
    bad: [
      { body: '<userTask id="u" activiti:assignee="${user"/>', ids: ['u'] },
      { body: '<serviceTask id="s" activiti:expression="${x = 5}"/>', ids: ['s'] },
      { body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>${n</loopCardinality></multiInstanceLoopCharacteristics></userTask>', ids: ['u'] },
    ],
    good: [{ body: '<userTask id="u" activiti:assignee="${initiator}" activiti:dueDate="P1D" activiti:candidateGroups="a,b"/><serviceTask id="s" activiti:expression="${bean.run(execution, \'x\')}"/>' }],
  }),
  defineRule({
    id: 'juel-string-concatenation',
    tag: 'X',
    severity: 'error',
    title: 'A string joined with "+" in an expression',
    why: 'The expression language (EL 2.2) has no string `+`: `${\'go-\' + region}` converts both sides to numbers and fails with `Cannot coerce \'go-\' of class java.lang.String to class java.lang.Double`. Inside a signal name, a condition or a listener it fails when the element is reached, not at deployment.',
    evidence: ['engine-findings 36', 'R1 §7.1 L27'],
    howToFix: 'Use `${\'go-\'.concat(region)}`, or write the parts as separate segments: `go-${region}`.',
    check: (node, api) => {
      for (const site of expressionSites(node)) {
        const result = checkJuel(site.text);
        if (result.stringPlus.length > 0) api.report(node, `${site.what} of ${label(node)}: ${result.stringPlus[0]!.message}`, site.entry ? { entryId: site.entry } : {});
      }
    },
    bad: [{ body: `<intermediateCatchEvent id="c"><signalEventDefinition activiti:signalExpression="\${'go-' + region}"/></intermediateCatchEvent>`, ids: ['c'] }],
    good: [{ body: `<userTask id="u" activiti:assignee="\${'go-'.concat(region)}" activiti:dueDate="\${a + 1}"/>` }],
  }),
  defineRule({
    id: 'invalid-timer-value',
    tag: 'L28',
    severity: 'error',
    title: 'A timer value that is not ISO 8601 or cron',
    why: '`timeDate` is an ISO 8601 date-time, `timeDuration` an ISO 8601 duration, `timeCycle` a repeating interval (`R3/PT10M`) or a Quartz cron expression (six or seven fields, exactly one of day-of-month and day-of-week is `?`). Anything else makes the timer job creation fail when the process is deployed (start timers) or when the token reaches the event.',
    evidence: ['R1 §8.3', 'R1 §7.1 L28'],
    howToFix: 'Correct the value in the **Timer** group; its preview shows the next fire time.',
    entry: 'timer.definition',
    check: (node, api) => {
      if (!is(node, 'bpmn:TimerEventDefinition')) return;
      const owner = node.$parent ?? node;
      const check = (what: string, text: string | undefined, test: (v: string) => { message: string } | undefined): void => {
        if (text === undefined || isBlank(text) || text.includes('${') || text.includes('#{')) return;
        const issue = test(text);
        if (issue) api.report(owner, `${what} of ${label(owner)}: ${issue.message}`);
      };
      check('timeDate', expressionText(child(node, 'timeDate')), timeDateIssue);
      check('timeDuration', expressionText(child(node, 'timeDuration')), timeDurationIssue);
      const cycle = child(node, 'timeCycle');
      check('timeCycle', expressionText(cycle), timeCycleIssue);
      if (cycle) check('end date', str(cycle, 'activiti:endDate'), END_DATE_ISSUE);
    },
    bad: [
      { body: '<intermediateCatchEvent id="t"><timerEventDefinition><timeDuration>10 minutes</timeDuration></timerEventDefinition></intermediateCatchEvent>', ids: ['t'] },
      { body: '<startEvent id="t"><timerEventDefinition><timeCycle>0 0 12 * * *</timeCycle></timerEventDefinition></startEvent>', ids: ['t'] },
    ],
    good: [
      { body: '<startEvent id="t"><timerEventDefinition><timeCycle activiti:endDate="2031-01-01T00:00:00">R3/PT10M</timeCycle></timerEventDefinition></startEvent>' },
      { body: '<startEvent id="t"><timerEventDefinition><timeCycle>0 0 12 * * ?</timeCycle></timerEventDefinition></startEvent><intermediateCatchEvent id="c"><timerEventDefinition><timeDate>2030-01-01T12:00:00</timeDate></timerEventDefinition></intermediateCatchEvent>' },
    ],
  }),
  defineRule({
    id: 'timer-end-date-before-start',
    tag: 'X',
    severity: 'warn',
    title: 'A start timer whose end date is before its first due date',
    why: 'The end date of a start timer is evaluated when the timer fires. When it lies before the due date, the engine deletes the job without starting an instance and without an error (debug log only).',
    evidence: ['engine-findings 26', 'engine-findings 27'],
    howToFix: 'Move the end date after the first due date, or remove it.',
    entry: 'timer.definition',
    check: (node, api) => {
      if (!is(node, 'bpmn:TimerEventDefinition')) return;
      const cycle = child(node, 'timeCycle');
      const end = cycle ? str(cycle, 'activiti:endDate') : undefined;
      if (!cycle || !end) return;
      const endTime = parseDateTime(end);
      const text = (expressionText(cycle) ?? '').trim();
      const parts = text.split('/');
      const startText = parts.length >= 3 ? parts.find((p, i) => i > 0 && parseDateTime(p) !== undefined) : undefined;
      const startTime = startText ? parseDateTime(startText) : undefined;
      if (endTime !== undefined && startTime !== undefined && endTime < startTime) api.report(node.$parent ?? node, `The end date ${end} is before the first due date ${startText}: the timer will never start an instance`);
    },
    bad: [{ body: '<startEvent id="t"><timerEventDefinition><timeCycle activiti:endDate="2030-01-01T00:00:00">R3/2031-01-01T00:00:00/PT1H</timeCycle></timerEventDefinition></startEvent>', ids: ['t'] }],
    good: [{ body: '<startEvent id="t"><timerEventDefinition><timeCycle activiti:endDate="2032-01-01T00:00:00">R3/2031-01-01T00:00:00/PT1H</timeCycle></timerEventDefinition></startEvent>' }],
  }),
];
