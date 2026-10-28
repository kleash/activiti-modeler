import type { DiagramBuilder, ShapeSpec } from '../src/builder';

/** One of every element variant, including those Activiti does not run (FEATURE_MATRIX §C), for the menu walks. */
export interface Sample {
  id: string;
  /** Hidden by §C (imported constructs) */
  hidden?: boolean;
}

const hidden = { allowHidden: true } as const;

export function buildKitchenSink(b: DiagramBuilder): Sample[] {
  const samples: Sample[] = [];
  const add = (spec: ShapeSpec, isHidden = false): void => {
    b.createShape({ allowHidden: true, ...spec });
    samples.push({ id: spec.id!, hidden: isHidden });
  };

  // start events (process level)
  add({ type: 'startEvent', id: 's_timer', eventDefinition: 'timer' });
  add({ type: 'startEvent', id: 's_msg', eventDefinition: 'message' });
  add({ type: 'startEvent', id: 's_sig', eventDefinition: 'signal' });
  add({ type: 'startEvent', id: 's_cond', eventDefinition: 'conditional' }, true);
  add({ type: 'startEvent', id: 's_esc', eventDefinition: 'escalation' }, true);

  // tasks
  add({ type: 'userTask', id: 't_user' });
  add({ type: 'serviceTask', id: 't_service' });
  add({ type: 'serviceTask', id: 't_decision', attrs: { implementation: 'dmn-connector.EXECUTE_TABLE' } });
  add({ type: 'serviceTask', id: 't_mail', attrs: { 'activiti:type': 'mail' } });
  add({ type: 'serviceTask', id: 't_shell', attrs: { 'activiti:type': 'shell' } });
  add({ type: 'serviceTask', id: 't_ws', attrs: { implementation: '##WebService' } }, true);
  add({ type: 'serviceTask', id: 't_dmn', attrs: { 'activiti:type': 'dmn' } }, true);
  add({ type: 'scriptTask', id: 't_script', attrs: { scriptFormat: 'javascript' } });
  add({ type: 'scriptTask', id: 't_groovy', attrs: { scriptFormat: 'groovy' } }, true);
  add({ type: 'sendTask', id: 't_send', attrs: { 'activiti:type': 'mail' } });
  add({ type: 'receiveTask', id: 't_receive' });
  add({ type: 'manualTask', id: 't_manual' });
  add({ type: 'task', id: 't_task' });
  add({ type: 'callActivity', id: 't_call' });
  add({ type: 'businessRuleTask', id: 't_rule' }, true);

  // gateways
  add({ type: 'exclusiveGateway', id: 'g_x' });
  add({ type: 'parallelGateway', id: 'g_p' });
  add({ type: 'inclusiveGateway', id: 'g_i' });
  add({ type: 'eventBasedGateway', id: 'g_e' });
  add({ type: 'complexGateway', id: 'g_c' }, true);

  // containers
  add({ type: 'subProcess', id: 'sp' });
  add({ type: 'subProcess', id: 'sp_collapsed', isExpanded: false });
  add({ type: 'subProcess', id: 'esp', triggeredByEvent: true });
  add({ type: 'transaction', id: 'tx' });
  add({ type: 'adHocSubProcess', id: 'adhoc' }, true);

  // end events
  add({ type: 'endEvent', id: 'e_none' });
  add({ type: 'endEvent', id: 'e_error', eventDefinition: 'error' });
  add({ type: 'endEvent', id: 'e_term', eventDefinition: 'terminate' });
  add({ type: 'endEvent', id: 'e_msg', eventDefinition: 'message' });
  add({ type: 'endEvent', id: 'e_signal', eventDefinition: 'signal' }, true);
  add({ type: 'endEvent', id: 'e_esc', eventDefinition: 'escalation' }, true);
  add({ type: 'endEvent', id: 'e_comp', eventDefinition: 'compensate' }, true);

  // intermediate events
  add({ type: 'intermediateCatchEvent', id: 'ic_timer', eventDefinition: 'timer' });
  add({ type: 'intermediateCatchEvent', id: 'ic_msg', eventDefinition: 'message' });
  add({ type: 'intermediateCatchEvent', id: 'ic_sig', eventDefinition: 'signal' });
  add({ type: 'intermediateCatchEvent', id: 'ic_link', eventDefinition: 'link' });
  add({ type: 'intermediateCatchEvent', id: 'ic_cond', eventDefinition: 'conditional' }, true);
  add({ type: 'intermediateThrowEvent', id: 'it_none' });
  add({ type: 'intermediateThrowEvent', id: 'it_sig', eventDefinition: 'signal' });
  add({ type: 'intermediateThrowEvent', id: 'it_comp', eventDefinition: 'compensate' });
  add({ type: 'intermediateThrowEvent', id: 'it_msg', eventDefinition: 'message' });
  add({ type: 'intermediateThrowEvent', id: 'it_link', eventDefinition: 'link' });
  add({ type: 'intermediateThrowEvent', id: 'it_esc', eventDefinition: 'escalation' }, true);

  // boundary events
  add({ type: 'boundaryEvent', id: 'b_timer', attachedTo: 't_user', eventDefinition: 'timer' });
  add({ type: 'boundaryEvent', id: 'b_timer_ni', attachedTo: 't_service', eventDefinition: 'timer', interrupting: false });
  add({ type: 'boundaryEvent', id: 'b_msg', attachedTo: 't_user', eventDefinition: 'message' });
  add({ type: 'boundaryEvent', id: 'b_sig', attachedTo: 't_user', eventDefinition: 'signal' });
  add({ type: 'boundaryEvent', id: 'b_err', attachedTo: 't_service', eventDefinition: 'error' });
  add({ type: 'boundaryEvent', id: 'b_comp', attachedTo: 't_script', eventDefinition: 'compensate' });
  add({ type: 'boundaryEvent', id: 'b_esc', attachedTo: 't_receive', eventDefinition: 'escalation' }, true);
  add({ type: 'boundaryEvent', id: 'b_cond', attachedTo: 't_manual', eventDefinition: 'conditional' }, true);
  add({ type: 'boundaryEvent', id: 'b_cancel', attachedTo: 'tx', eventDefinition: 'cancel' });
  add({ type: 'boundaryEvent', id: 'b_tx_timer', attachedTo: 'tx', eventDefinition: 'timer' });

  // data and artifacts
  add({ type: 'dataObjectReference', id: 'd_obj' });
  add({ type: 'dataStoreReference', id: 'd_store' });
  add({ type: 'textAnnotation', id: 'note' });
  add({ type: 'group', id: 'grp' }, true);

  // inside the containers
  add({ type: 'startEvent', id: 'sp_start', parent: 'sp' });
  add({ type: 'userTask', id: 'sp_task', parent: 'sp' });
  add({ type: 'startEvent', id: 'esp_msg', parent: 'esp', eventDefinition: 'message' });
  add({ type: 'startEvent', id: 'esp_msg_ni', parent: 'esp', eventDefinition: 'message', interrupting: false });
  add({ type: 'startEvent', id: 'esp_err', parent: 'esp', eventDefinition: 'error' });
  add({ type: 'startEvent', id: 'esp_sig', parent: 'esp', eventDefinition: 'signal' }, true);
  add({ type: 'startEvent', id: 'esp_timer', parent: 'esp', eventDefinition: 'timer' }, true);
  add({ type: 'startEvent', id: 'sp_typed', parent: 'sp', eventDefinition: 'timer' }, true);
  add({ type: 'startEvent', id: 'tx_start', parent: 'tx' });
  add({ type: 'endEvent', id: 'tx_cancel', parent: 'tx', eventDefinition: 'cancel' });
  add({ type: 'endEvent', id: 'tx_end', parent: 'tx' });
  add({ type: 'userTask', id: 'tx_task', parent: 'tx' });

  // flows
  b.connect('t_user', 't_service', { id: 'f_user_service' });
  b.connect('g_x', 't_task', { id: 'f_gw_task' });
  b.connect('g_e', 'ic_msg', { id: 'f_eg_msg' });
  b.connect('t_service', 'e_none', { id: 'f_cond', name: 'cond' });
  void hidden;
  return samples;
}
