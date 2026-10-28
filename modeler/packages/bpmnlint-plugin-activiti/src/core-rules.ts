import { definitionLabel, engineDefinitions } from './model';
import type { ME } from './types';

/** The rules of bpmnlint 12 (imported one by one: the Vite bundle and Node resolve them statically, no file system lookups). */
import adHocSubProcess from 'bpmnlint/rules/ad-hoc-sub-process';
import conditionalEvent from 'bpmnlint/rules/conditional-event';
import conditionalFlows from 'bpmnlint/rules/conditional-flows';
import endEventRequired from 'bpmnlint/rules/end-event-required';
import eventBasedGateway from 'bpmnlint/rules/event-based-gateway';
import eventSubProcessTypedStartEvent from 'bpmnlint/rules/event-sub-process-typed-start-event';
import fakeJoin from 'bpmnlint/rules/fake-join';
import global from 'bpmnlint/rules/global';
import labelRequired from 'bpmnlint/rules/label-required';
import linkEvent from 'bpmnlint/rules/link-event';
import noBpmndi from 'bpmnlint/rules/no-bpmndi';
import noComplexGateway from 'bpmnlint/rules/no-complex-gateway';
import noDisconnected from 'bpmnlint/rules/no-disconnected';
import noDuplicateSequenceFlows from 'bpmnlint/rules/no-duplicate-sequence-flows';
import noGatewayJoinFork from 'bpmnlint/rules/no-gateway-join-fork';
import noImplicitEnd from 'bpmnlint/rules/no-implicit-end';
import noImplicitSplit from 'bpmnlint/rules/no-implicit-split';
import noImplicitStart from 'bpmnlint/rules/no-implicit-start';
import noInclusiveGateway from 'bpmnlint/rules/no-inclusive-gateway';
import noOverlappingElements from 'bpmnlint/rules/no-overlapping-elements';
import singleBlankStartEvent from 'bpmnlint/rules/single-blank-start-event';
import singleEventDefinition from 'bpmnlint/rules/single-event-definition';
import standardSize from 'bpmnlint/rules/standard-size';
import startEventRequired from 'bpmnlint/rules/start-event-required';
import subProcessBlankStartEvent from 'bpmnlint/rules/sub-process-blank-start-event';
import superfluousGateway from 'bpmnlint/rules/superfluous-gateway';
import superfluousLabel from 'bpmnlint/rules/superfluous-label';
import superfluousTermination from 'bpmnlint/rules/superfluous-termination';

type CoreFactory = (config?: unknown) => { check: unknown; meta?: unknown };

/**
 * Activiti reads every supported event definition of an event but uses the first one only (engine-findings N01.4), so the diagnosis of
 * several definitions on one event is multiplicity, and bpmnlint's message gets the Activiti consequence.
 */
const singleEventDefinitionForActiviti: CoreFactory = (config) => {
  const rule = singleEventDefinition(config) as { check: (node: ME, reporter: { report: (id: string, message: string, ...rest: unknown[]) => void }) => void; meta?: unknown };
  return {
    ...rule,
    check: (node: ME, reporter: { report: (id: string, message: string, ...rest: unknown[]) => void }) =>
      rule.check(node, {
        report: (id, message, ...rest) => {
          const used = engineDefinitions(node)[0];
          reporter.report(id, used ? `${message}: Activiti uses only the first definition it reads (${definitionLabel(used)}) and ignores the others` : message, ...rest);
        },
      }),
  };
};

export const CORE_RULES: Record<string, (config?: unknown) => { check: unknown; meta?: unknown }> = {
  'ad-hoc-sub-process': adHocSubProcess,
  'conditional-event': conditionalEvent,
  'conditional-flows': conditionalFlows,
  'end-event-required': endEventRequired,
  'event-based-gateway': eventBasedGateway,
  'event-sub-process-typed-start-event': eventSubProcessTypedStartEvent,
  'fake-join': fakeJoin,
  'global': global,
  'label-required': labelRequired,
  'link-event': linkEvent,
  'no-bpmndi': noBpmndi,
  'no-complex-gateway': noComplexGateway,
  'no-disconnected': noDisconnected,
  'no-duplicate-sequence-flows': noDuplicateSequenceFlows,
  'no-gateway-join-fork': noGatewayJoinFork,
  'no-implicit-end': noImplicitEnd,
  'no-implicit-split': noImplicitSplit,
  'no-implicit-start': noImplicitStart,
  'no-inclusive-gateway': noInclusiveGateway,
  'no-overlapping-elements': noOverlappingElements,
  'single-blank-start-event': singleBlankStartEvent,
  'single-event-definition': singleEventDefinitionForActiviti,
  'standard-size': standardSize,
  'start-event-required': startEventRequired,
  'sub-process-blank-start-event': subProcessBlankStartEvent,
  'superfluous-gateway': superfluousGateway,
  'superfluous-label': superfluousLabel,
  'superfluous-termination': superfluousTermination,
};
