# Lint rules

The modeler lints every process while you edit it, and the whole project before it is deployed. The rules come from three places:

1. **78 mirrors of the Activiti validator** (`ProcessValidator`): one rule per problem key, with the engine's severity and its key in the message. They find what the engine rejects when the process is deployed, while you edit.
2. **Rules for what the engine does not catch**: constructs Activiti does not execute, Camunda leftovers, mappings that are silently inert, and the traps found while testing the engine (numbered L1 to L37 in the feature matrix, plus the engine-behaviour rules).
3. **bpmnlint `recommended`**, tuned (see below).

In total 156 Activiti rules (111 errors, 36 warnings, 9 notes by default). The **Problems** panel shows them with the element, a link to the page of the rule and, where one exists, a quick fix. When a modeler server is connected its own validation (`/api/dev/validate`, tagged *engine*) is merged in. Errors block a deployment from the modeler.

Configure a rule by name in the `rules` of a bpmnlint config: `"activiti/missing-mapping": "off"`. Use the config `plugin:activiti/recommended` (all rules at the default severity) or `plugin:activiti/all`.

## Tuning of bpmnlint `recommended`

| bpmnlint rule | In `activiti:recommended` | Why |
|---|---|---|
| [no-inclusive-gateway](bpmnlint-no-inclusive-gateway.md) | off | Activiti executes inclusive gateways. |
| [no-complex-gateway](bpmnlint-no-complex-gateway.md) | error | Activiti runs it as an exclusive gateway. |
| [ad-hoc-sub-process](bpmnlint-ad-hoc-sub-process.md) | error | BPMN rule; the ad-hoc sub process itself is reported by activiti/no-ad-hoc-sub-process. |
| [event-sub-process-typed-start-event](bpmnlint-event-sub-process-typed-start-event.md) | error | An untyped start never fires. |
| label-required | warning | Style only; an error would block the deployment of an unlabeled start event. |
| end-event-required | warning | Activiti ends an execution that has no outgoing flow. |
| no-implicit-end | warning | Same. |
| no-implicit-start | warning | Style only. |
| no-implicit-split | warning | Conditional flows from tasks are supported (feature F3). |
| no-gateway-join-fork | warning | Style only. |
| no-duplicate-sequence-flows | warning | Runs as drawn (two tokens). |
| conditional-flows | warning | Activiti reports it as a warning too (`EXCLUSIVE_GATEWAY_SEQ_FLOW_WITHOUT_CONDITIONS`). |
| no-disconnected | warning | An unfinished diagram runs fine, and a new process is a lone start event. |
| single-blank-start-event | off | Covered by `START_EVENT_MULTIPLE_FOUND` with the engine's key. |

Every other bpmnlint recommended rule keeps its bpmnlint severity.

## The numbered rules

FEATURE_MATRIX §D and R1 §7.1 number the rules that the engine does not check. A number may be covered by more than one rule.

| # | What | Rule |
|---|---|---|
| L1 | camunda: / zeebe: attributes and elements | [no-camunda-extensions](no-camunda-extensions.md) |
| L2 | businessRuleTask | [no-business-rule-task](no-business-rule-task.md) |
| L3 | serviceTask / sendTask type other than mail or shell | [unsupported-service-task-type](unsupported-service-task-type.md), [service-task-invalid-type](service-task-invalid-type.md) |
| L4 | complexGateway, adHocSubProcess | [bpmnlint/no-complex-gateway](bpmnlint-no-complex-gateway.md), [no-ad-hoc-sub-process](no-ad-hoc-sub-process.md) |
| L5 | signal / timer start in an event sub process | [no-signal-start-in-event-subprocess](no-signal-start-in-event-subprocess.md), [event-subprocess-invalid-start-event-definition](event-subprocess-invalid-start-event-definition.md) |
| L6 | signal / escalation / link / compensation end event, escalation throw | [no-signal-end-event](no-signal-end-event.md), [no-unsupported-end-event](no-unsupported-end-event.md), [no-unsupported-event-definition](no-unsupported-event-definition.md) |
| L7 | escalation / conditional event definitions | [no-unsupported-event-definition](no-unsupported-event-definition.md), [boundary-event-no-event-definition](boundary-event-no-event-definition.md) |
| L8 | connector not in the project | [connector-bean-unknown](connector-bean-unknown.md) |
| L9 | missing mapping | [missing-mapping](missing-mapping.md) |
| L10 | extensions entry for an unknown process | [extensions-unknown-process](extensions-unknown-process.md), [extensions-unknown-element](extensions-unknown-element.md) |
| L11 | invalid property type | [property-type-invalid](property-type-invalid.md) |
| L12 | cancel end without compensable work | [cancel-end-without-compensation](cancel-end-without-compensation.md) |
| L13 | send task without mail | [send-task-invalid-implementation](send-task-invalid-implementation.md) |
| L14 | script format without an engine | [unsupported-script-format](unsupported-script-format.md) |
| L15 | process not executable; connector task without a name | [all-process-definitions-not-executable](all-process-definitions-not-executable.md), [process-definition-not-executable](process-definition-not-executable.md), [connector-task-missing-name](connector-task-missing-name.md) |
| L16 | minified multi-instance XML | [multi-instance-minified-xml](multi-instance-minified-xml.md) |
| L17 | message start with the same name twice | [message-start-name-not-unique](message-start-name-not-unique.md) |
| L18 | message throw without a delegate | [message-throw-without-delegate](message-throw-without-delegate.md) |
| L19 | event-based gateway target | [event-gateway-only-connected-to-intermediate-events](event-gateway-only-connected-to-intermediate-events.md) |
| L20 | skipExpression without the enabling variable | [skip-expression-needs-enable-variable](skip-expression-needs-enable-variable.md) |
| L21 | output target not declared | [output-target-undeclared](output-target-undeclared.md) |
| L22 | mapping keyed to a missing element | [extensions-unknown-element](extensions-unknown-element.md) |
| L23 | decision task without a (known) decision | [decision-task-unknown-decision](decision-task-unknown-decision.md) |
| L24 | connector action missing; required input unmapped | [connector-action-unknown](connector-action-unknown.md), [connector-required-input-unmapped](connector-required-input-unmapped.md) |
| L25 | called element invalid or unknown | [called-element-invalid](called-element-invalid.md), [called-element-unknown](called-element-unknown.md) |
| L26 | activiti:initiator | [initiator-needs-authenticated-user](initiator-needs-authenticated-user.md) |
| L27 | malformed JUEL | [invalid-juel-expression](invalid-juel-expression.md), [seq-flow-invalid-conditional-expression](seq-flow-invalid-conditional-expression.md) |
| L28 | invalid timer value | [invalid-timer-value](invalid-timer-value.md) |
| L29 | DMN construct not supported by the DMN engine profile | [dmn-unsupported-on-operaton](dmn-unsupported-on-operaton.md) |
| L30 | message subscription clash | [message-subscription-clash](message-subscription-clash.md) |
| L31 | failedJobRetryTimeCycle on a non-service task | [failed-job-retry-ignored](failed-job-retry-ignored.md) |
| L32 | mapException where it is ignored | [map-exception-ignored](map-exception-ignored.md) |
| L33 | DMN output without a name | [dmn-output-without-name](dmn-output-without-name.md) |
| L34 | process keys and message start names unique in the project | [process-key-not-unique-in-project](process-key-not-unique-in-project.md), [message-start-name-not-unique](message-start-name-not-unique.md) |
| L35 | loopDataInputRef / loopDataOutputRef not a variable name | [loop-data-ref-not-variable-name](loop-data-ref-not-variable-name.md) |
| L36 | outdated connector template | [connector-template-outdated](connector-template-outdated.md) |
| L37 | decision input unmapped | [decision-input-unmapped](decision-input-unmapped.md) |

## Mirrors of the engine validator

| Rule | Severity | What |
|---|---|---|
| [all-process-definitions-not-executable](all-process-definitions-not-executable.md) | error | No process of the file is executable |
| [process-definition-not-executable](process-definition-not-executable.md) | warning | A process is not executable while another one in the file is |
| [process-definition-id-not-unique](process-definition-id-not-unique.md) | error | Two processes in the file have the same id |
| [process-definition-id-too-long](process-definition-id-too-long.md) | error | The process id is longer than 255 characters |
| [process-definition-name-too-long](process-definition-name-too-long.md) | error | The process name is longer than 255 characters |
| [process-definition-documentation-too-long](process-definition-documentation-too-long.md) | error | The process documentation is longer than 2000 characters |
| [bpmn-model-target-namespace-too-long](bpmn-model-target-namespace-too-long.md) | error | The targetNamespace of the definitions is longer than 255 characters |
| [flow-element-id-too-long](flow-element-id-too-long.md) | error | The id of an activity is longer than 255 characters |
| [association-invalid-source-reference](association-invalid-source-reference.md) | error | An association has no source |
| [association-invalid-target-reference](association-invalid-target-reference.md) | error | An association has no target |
| [signal-missing-id](signal-missing-id.md) | error | A signal definition has no id |
| [signal-missing-name](signal-missing-name.md) | error | A signal definition has no name |
| [signal-duplicate-name](signal-duplicate-name.md) | error | Two signal definitions have the same name |
| [signal-invalid-scope](signal-invalid-scope.md) | error | A signal has a scope other than global or processInstance |
| [operation-invalid-in-message-reference](operation-invalid-in-message-reference.md) | error | An operation with an implementation refers to an input message that does not exist |
| [error-missing-error-code](error-missing-error-code.md) | error | An error definition has no errorCode |
| [data-object-missing-name](data-object-missing-name.md) | error | A data object has no name |
| [message-invalid-item-ref](message-invalid-item-ref.md) | error | A message refers to an item definition that does not exist |
| [multi-instance-missing-collection](multi-instance-missing-collection.md) | error | A multi-instance activity has neither a cardinality nor a collection |
| [data-association-missing-targetref](data-association-missing-targetref.md) | error | A data input / output association of an activity has no target |
| [di-invalid-reference](di-invalid-reference.md) | warning | A diagram shape or edge refers to an element the Activiti model does not contain |
| [di-does-not-reference-flownode](di-does-not-reference-flownode.md) | warning | A diagram shape refers to a flow element that is not a flow node |
| [di-does-not-reference-seq-flow](di-does-not-reference-seq-flow.md) | warning | A diagram edge refers to a flow element that is not a sequence flow |
| [flow-element-async-not-available](flow-element-async-not-available.md) | warning | An element is async but the engine has no async executor |
| [event-timer-async-not-available](event-timer-async-not-available.md) | warning | A timer event needs the async executor, which is off |
| [signal-async-not-available](signal-async-not-available.md) | warning | An asynchronous signal throw needs the async executor, which is off |
| [start-event-multiple-found](start-event-multiple-found.md) | error | A process has more than one none start event |
| [start-event-invalid-event-definition](start-event-invalid-event-definition.md) | error | A process start event has an event definition other than message, timer or signal |
| [subprocess-multiple-start-events](subprocess-multiple-start-events.md) | error | An embedded sub process or transaction has more than one start event |
| [subprocess-start-event-event-definition-not-allowed](subprocess-start-event-event-definition-not-allowed.md) | error | The start event of an embedded sub process has an event definition |
| [event-subprocess-invalid-start-event-definition](event-subprocess-invalid-start-event-definition.md) | error | The start event of an event sub process is not an error, message or signal start |
| [seq-flow-invalid-src](seq-flow-invalid-src.md) | error | A sequence flow has no valid source |
| [seq-flow-invalid-target](seq-flow-invalid-target.md) | error | A sequence flow has no valid target |
| [seq-flow-invalid-target-different-scope](seq-flow-invalid-target-different-scope.md) | error | A sequence flow connects elements of different containers |
| [seq-flow-invalid-conditional-expression](seq-flow-invalid-conditional-expression.md) | error | The condition of a sequence flow is not a valid JUEL expression |
| [exclusive-gateway-no-outgoing-seq-flow](exclusive-gateway-no-outgoing-seq-flow.md) | error | An exclusive gateway has no outgoing sequence flow |
| [exclusive-gateway-condition-not-allowed-on-single-seq-flow](exclusive-gateway-condition-not-allowed-on-single-seq-flow.md) | error | The only outgoing flow of an exclusive gateway has a condition |
| [exclusive-gateway-condition-on-default-seq-flow](exclusive-gateway-condition-on-default-seq-flow.md) | error | The default flow of an exclusive gateway has a condition |
| [exclusive-gateway-seq-flow-without-conditions](exclusive-gateway-seq-flow-without-conditions.md) | warning | An exclusive gateway has outgoing flows without a condition that are not the default |
| [event-gateway-only-connected-to-intermediate-events](event-gateway-only-connected-to-intermediate-events.md) | error | An event-based gateway leads to something other than an intermediate catch event |
| [boundary-event-no-event-definition](boundary-event-no-event-definition.md) | error | A boundary event has no event definition Activiti understands |
| [boundary-event-invalid-event-definition](boundary-event-invalid-event-definition.md) | error | A boundary event has a link definition |
| [boundary-event-cancel-only-on-transaction](boundary-event-cancel-only-on-transaction.md) | error | A cancel boundary event is attached to something other than a transaction |
| [boundary-event-multiple-cancel-on-transaction](boundary-event-multiple-cancel-on-transaction.md) | error | A transaction has more than one cancel boundary event |
| [compensate-event-multiple-on-boundary](compensate-event-multiple-on-boundary.md) | error | An activity has more than one compensation boundary event |
| [compensate-event-invalid-activity-ref](compensate-event-invalid-activity-ref.md) | error | A compensation event refers to an activity that does not exist |
| [message-event-missing-message-ref](message-event-missing-message-ref.md) | error | A message event names no message |
| [message-event-invalid-message-ref](message-event-invalid-message-ref.md) | error | A message event refers to a message that is not defined |
| [message-event-multiple-on-boundary-same-message-id](message-event-multiple-on-boundary-same-message-id.md) | error | An activity has two message boundary events for the same message |
| [signal-event-missing-signal-ref](signal-event-missing-signal-ref.md) | error | A signal event names no signal |
| [signal-event-invalid-signal-ref](signal-event-invalid-signal-ref.md) | error | A signal event refers to a signal that is not defined |
| [event-timer-missing-configuration](event-timer-missing-configuration.md) | error | A timer event has no date, duration or cycle |
| [intermediate-catch-event-no-eventdefinition](intermediate-catch-event-no-eventdefinition.md) | error | An intermediate catch event has no event definition |
| [intermediate-catch-event-invalid-eventdefinition](intermediate-catch-event-invalid-eventdefinition.md) | error | An intermediate catch event has an error, cancel or compensate definition |
| [throw-event-invalid-eventdefinition](throw-event-invalid-eventdefinition.md) | error | An intermediate throw event has a definition other than signal, compensate, message or link |
| [end-event-cancel-only-inside-transaction](end-event-cancel-only-inside-transaction.md) | error | A cancel end event is not directly inside a transaction |
| [link-event-definition-missing-target](link-event-definition-missing-target.md) | error | A link throw event has no target |
| [link-event-definition-missing-target-empty-name](link-event-definition-missing-target-empty-name.md) | error | A link throw event has no target (the event has no name) |
| [link-event-definition-missing-source](link-event-definition-missing-source.md) | error | A link catch event has no source |
| [link-event-definition-missing-source-empty-name](link-event-definition-missing-source-empty-name.md) | error | A link catch event has no source (the event has no name) |
| [execution-listener-implementation-missing](execution-listener-implementation-missing.md) | error | An execution listener has no class, expression or delegate expression |
| [execution-listener-invalid-implementation-type](execution-listener-invalid-implementation-type.md) | error | A transaction dependent execution listener uses an expression |
| [user-task-listener-implementation-missing](user-task-listener-implementation-missing.md) | error | A task listener has no class, expression or delegate expression |
| [event-listener-implementation-missing](event-listener-implementation-missing.md) | error | A process event listener has no implementation |
| [event-listener-invalid-throw-event-type](event-listener-invalid-throw-event-type.md) | error | A process event listener throws something other than a signal, global signal, message or error |
| [service-task-missing-implementation](service-task-missing-implementation.md) | error | A service task has no implementation |
| [service-task-invalid-type](service-task-invalid-type.md) | error | A service task has an unknown activiti:type |
| [service-task-result-var-name-with-delegate](service-task-result-var-name-with-delegate.md) | error | A service task with a Java class or delegate expression has a result variable name |
| [service-task-webservice-invalid-operation-ref](service-task-webservice-invalid-operation-ref.md) | error | A web service task refers to an operation that does not exist |
| [send-task-invalid-implementation](send-task-invalid-implementation.md) | error | A send task is not a mail task |
| [send-task-invalid-type](send-task-invalid-type.md) | error | A send task has a type other than mail, mule or camel |
| [send-task-webservice-invalid-operation-ref](send-task-webservice-invalid-operation-ref.md) | error | A web service send task refers to an operation that does not exist |
| [script-task-missing-script](script-task-missing-script.md) | error | A script task has no script |
| [mail-task-no-recipient](mail-task-no-recipient.md) | error | A mail task has no "to" field |
| [mail-task-no-content](mail-task-no-content.md) | error | A mail task has no text, html, textVar or htmlVar field |
| [shell-task-no-command](shell-task-no-command.md) | error | A shell task has no command field |
| [shell-task-invalid-param](shell-task-invalid-param.md) | error | A shell task has a wait, redirectError or cleanEnv field that is not true or false |
| [dmn-task-no-key](dmn-task-no-key.md) | error | A service task of type dmn has no decisionTableReferenceKey |

## Constructs Activiti 9 does not execute

These are hidden from the palette and menus; an imported model that has one is reported (FEATURE_MATRIX §C).

| Rule | Severity | What |
|---|---|---|
| [no-business-rule-task](no-business-rule-task.md) | error | A business rule task |
| [no-ad-hoc-sub-process](no-ad-hoc-sub-process.md) | error | An ad-hoc sub process |
| [no-unsupported-event-definition](no-unsupported-event-definition.md) | error | An escalation or conditional event definition |
| [no-signal-start-in-event-subprocess](no-signal-start-in-event-subprocess.md) | error | A signal start event in an event sub process |
| [no-signal-end-event](no-signal-end-event.md) | error | A signal end event |
| [no-unsupported-end-event](no-unsupported-end-event.md) | error | A link or compensation end event |
| [unsupported-service-task-type](unsupported-service-task-type.md) | error | A service or send task of type dmn, camel or mule |
| [no-web-service-task](no-web-service-task.md) | error | A web service task (implementation ##WebService) |
| [no-standard-loop](no-standard-loop.md) | error | A standard loop marker |
| [no-group](no-group.md) | warning | A group |
| [unsupported-script-format](unsupported-script-format.md) | error | A script task in a language without an engine |
| [no-instantiating-event-gateway](no-instantiating-event-gateway.md) | error | An instantiating or parallel event-based gateway |

## Camunda and foreign content

| Rule | Severity | What |
|---|---|---|
| [no-camunda-extensions](no-camunda-extensions.md) | error | A camunda: or zeebe: attribute or element |
| [foreign-attribute-namespace](foreign-attribute-namespace.md) | error | An attribute from a namespace the serializer does not allow |
| [unqualified-activiti-attribute](unqualified-activiti-attribute.md) | warning | An Activiti attribute written without the activiti: prefix in the file |
| [undeclared-qname-prefix](undeclared-qname-prefix.md) | error | A prefixed QName value whose prefix is not declared |
| [duplicate-element-id](duplicate-element-id.md) | error | Two elements have the same id |

## Mappings, connectors, decisions and the project

| Rule | Severity | What |
|---|---|---|
| [extensions-unknown-process](extensions-unknown-process.md) | error | The extensions file configures a process that is not in this file |
| [extensions-unknown-element](extensions-unknown-element.md) | error | A mapping or constant belongs to an element that does not exist |
| [property-type-invalid](property-type-invalid.md) | error | A process variable has a type the runtime does not know |
| [output-target-undeclared](output-target-undeclared.md) | warning | An output mapping writes a variable that is not declared in the process properties |
| [extensions-invalid-structure](extensions-invalid-structure.md) | error | The extensions file has a mapping the runtime cannot read |
| [json-property-without-default](json-property-without-default.md) | info | A json (or unknown type) property without a default value |
| [missing-mapping](missing-mapping.md) | warning | A user task, call activity, message catch event or connector task without an input / output mapping |
| [signal-catch-has-mapping](signal-catch-has-mapping.md) | warning | A signal catch event has a mapping |
| [parallel-multi-instance-user-task-map-all](parallel-multi-instance-user-task-map-all.md) | warning | MAP_ALL on a parallel multi-instance user task |
| [user-task-map-all-copies-assignee](user-task-map-all-copies-assignee.md) | info | MAP_ALL on a user task |
| [connector-bean-unknown](connector-bean-unknown.md) | error | A service task calls a connector that is not in the project |
| [connector-action-unknown](connector-action-unknown.md) | error | A service task calls an action the connector does not define |
| [connector-required-input-unmapped](connector-required-input-unmapped.md) | error | A required input of a connector action is not mapped |
| [connector-template-outdated](connector-template-outdated.md) | warning | A connector task uses an older version of its template |
| [decision-task-unknown-decision](decision-task-unknown-decision.md) | error | A decision task has no decision, or one that is not in the project |
| [decision-input-unmapped](decision-input-unmapped.md) | warning | A decision input is not mapped |
| [called-element-unknown](called-element-unknown.md) | warning | A call activity calls a process that is not in the project |
| [call-activity-called-process-without-extensions](call-activity-called-process-without-extensions.md) | warning | Inputs are mapped into a called process that has no extensions entry |
| [process-key-not-unique-in-project](process-key-not-unique-in-project.md) | error | Two files of the project define a process with the same key |
| [message-start-name-not-unique](message-start-name-not-unique.md) | error | Two message start events listen for the same message name |
| [skip-expression-needs-enable-variable](skip-expression-needs-enable-variable.md) | warning | A skip expression without the _ACTIVITI_SKIP_EXPRESSION_ENABLED variable |

## Expressions and timers

| Rule | Severity | What |
|---|---|---|
| [invalid-juel-expression](invalid-juel-expression.md) | error | An expression that is not valid JUEL |
| [juel-string-concatenation](juel-string-concatenation.md) | error | A string joined with "+" in an expression |
| [invalid-timer-value](invalid-timer-value.md) | error | A timer value that is not ISO 8601 or cron |
| [timer-end-date-before-start](timer-end-date-before-start.md) | warning | A start timer whose end date is before its first due date |

## Other rules

| Rule | Severity | What |
|---|---|---|
| [message-event-subprocess-multi-instance](message-event-subprocess-multi-instance.md) | warning | An interrupting message event sub process in a process with a multi-instance activity |
| [connector-task-missing-name](connector-task-missing-name.md) | warning | A connector service task without a name |
| [called-element-invalid](called-element-invalid.md) | error | A call activity without a valid called element |
| [multi-instance-call-activity-output](multi-instance-call-activity-output.md) | warning | Output from a multi-instance call activity |
| [message-subscription-clash](message-subscription-clash.md) | warning | Two message subscriptions of the same name can be active at the same time |
| [initiator-needs-authenticated-user](initiator-needs-authenticated-user.md) | info | A start event stores the process initiator |
| [cancel-end-without-compensation](cancel-end-without-compensation.md) | error | A cancel end event in a transaction without compensable work before it |
| [message-throw-without-delegate](message-throw-without-delegate.md) | warning | A message throw event without a delegate |
| [message-definition-field-ignored](message-definition-field-ignored.md) | warning | An activiti:field on a message event definition |
| [failed-job-retry-ignored](failed-job-retry-ignored.md) | warning | failedJobRetryTimeCycle on an element other than a service task |
| [map-exception-ignored](map-exception-ignored.md) | warning | mapException on an element where Activiti does not wire it |
| [loop-data-ref-not-variable-name](loop-data-ref-not-variable-name.md) | error | A multi-instance loopDataInputRef / loopDataOutputRef that is not a variable name |
| [auto-store-variables-no-effect](auto-store-variables-no-effect.md) | warning | autoStoreVariables on a script task |
| [signal-expression-with-declared-signal](signal-expression-with-declared-signal.md) | error | A signal named by an expression in a file that declares signals |
| [signal-expression-catch-stale-subscription](signal-expression-catch-stale-subscription.md) | warning | A signal catch event named by an expression |
| [signal-throw-async-drops-payload](signal-throw-async-drops-payload.md) | info | An asynchronous signal throw |
| [compensate-activity-ref-not-handler](compensate-activity-ref-not-handler.md) | warning | A compensation throw event that names the compensated activity instead of its handler |
| [compensate-wait-for-completion-ignored](compensate-wait-for-completion-ignored.md) | info | waitForCompletion="false" on a compensation throw event |
| [error-boundary-non-interrupting](error-boundary-non-interrupting.md) | info | cancelActivity="false" on an error boundary event |
| [process-end-listener-sets-variable](process-end-listener-sets-variable.md) | warning | A process end listener that sets a variable |
| [listener-expression-calls-notify](listener-expression-calls-notify.md) | warning | A listener expression that calls a method named notify |
| [exclusive-gateway-end-listener](exclusive-gateway-end-listener.md) | warning | An end execution listener on an exclusive gateway |
| [event-listener-invalid-events](event-listener-invalid-events.md) | error | A process event listener with an unknown event type or entity type |
| [data-object-type-unknown](data-object-type-unknown.md) | error | A data object of a type Activiti does not know |
| [mail-task-without-from](mail-task-without-from.md) | info | A mail task without a "from" field |
| [shell-task-needs-opt-in](shell-task-needs-opt-in.md) | info | A shell task |
| [decision-task-needs-dmn-connector](decision-task-needs-dmn-connector.md) | info | A decision task, which needs the DMN connector in the application |
| [artifact-before-flow-element](artifact-before-flow-element.md) | error | A text annotation or association written before a flow element |
| [multi-instance-minified-xml](multi-instance-minified-xml.md) | error | The closing tag of a multi-instance activity follows its loop element without a line break |
| [bpmn-unreadable](bpmn-unreadable.md) | error | A BPMN file is not well-formed XML |
| [extensions-unreadable](extensions-unreadable.md) | error | An extensions JSON file cannot be read |
| [extensions-orphan-file](extensions-orphan-file.md) | warning | An extensions file has no process file next to it |
| [dmn-unsupported-on-operaton](dmn-unsupported-on-operaton.md) | error | A DMN construct only the KIE engine can evaluate (business knowledge model, boxed context, invocation, ...) |
| [dmn-output-without-name](dmn-output-without-name.md) | error | A decision table output column has no name |
| [dmn-legacy-version](dmn-legacy-version.md) | warning | A DMN 1.1 or 1.2 file |
| [dmn-unreadable](dmn-unreadable.md) | error | A DMN file is not a DMN definitions document |

## Engine problem keys

Every key of `org.activiti.validation.validator.Problems` (Activiti 9.0.0) and the rule that mirrors it.

| Key | Rule |
|---|---|
| `ALL_PROCESS_DEFINITIONS_NOT_EXECUTABLE` | [all-process-definitions-not-executable](all-process-definitions-not-executable.md) |
| `PROCESS_DEFINITION_NOT_EXECUTABLE` | [process-definition-not-executable](process-definition-not-executable.md) |
| `ASSOCIATION_INVALID_SOURCE_REFERENCE` | [association-invalid-source-reference](association-invalid-source-reference.md) |
| `ASSOCIATION_INVALID_TARGET_REFERENCE` | [association-invalid-target-reference](association-invalid-target-reference.md) |
| `EXECUTION_LISTENER_IMPLEMENTATION_MISSING` | [execution-listener-implementation-missing](execution-listener-implementation-missing.md) |
| `EXECUTION_LISTENER_INVALID_IMPLEMENTATION_TYPE` | [execution-listener-invalid-implementation-type](execution-listener-invalid-implementation-type.md) |
| `EVENT_LISTENER_IMPLEMENTATION_MISSING` | [event-listener-implementation-missing](event-listener-implementation-missing.md) |
| `EVENT_LISTENER_INVALID_THROW_EVENT_TYPE` | [event-listener-invalid-throw-event-type](event-listener-invalid-throw-event-type.md) |
| `START_EVENT_MULTIPLE_FOUND` | [start-event-multiple-found](start-event-multiple-found.md) |
| `START_EVENT_INVALID_EVENT_DEFINITION` | [start-event-invalid-event-definition](start-event-invalid-event-definition.md) |
| `SEQ_FLOW_INVALID_SRC` | [seq-flow-invalid-src](seq-flow-invalid-src.md) |
| `SEQ_FLOW_INVALID_TARGET` | [seq-flow-invalid-target](seq-flow-invalid-target.md) |
| `SEQ_FLOW_INVALID_TARGET_DIFFERENT_SCOPE` | [seq-flow-invalid-target-different-scope](seq-flow-invalid-target-different-scope.md) |
| `SEQ_FLOW_INVALID_CONDITIONAL_EXPRESSION` | [seq-flow-invalid-conditional-expression](seq-flow-invalid-conditional-expression.md) |
| `USER_TASK_LISTENER_IMPLEMENTATION_MISSING` | [user-task-listener-implementation-missing](user-task-listener-implementation-missing.md) |
| `SERVICE_TASK_INVALID_TYPE` | [service-task-invalid-type](service-task-invalid-type.md) |
| `SERVICE_TASK_RESULT_VAR_NAME_WITH_DELEGATE` | [service-task-result-var-name-with-delegate](service-task-result-var-name-with-delegate.md) |
| `SERVICE_TASK_MISSING_IMPLEMENTATION` | [service-task-missing-implementation](service-task-missing-implementation.md) |
| `SERVICE_TASK_WEBSERVICE_INVALID_OPERATION_REF` | [service-task-webservice-invalid-operation-ref](service-task-webservice-invalid-operation-ref.md) |
| `SEND_TASK_INVALID_IMPLEMENTATION` | [send-task-invalid-implementation](send-task-invalid-implementation.md) |
| `SEND_TASK_INVALID_TYPE` | [send-task-invalid-type](send-task-invalid-type.md) |
| `SEND_TASK_WEBSERVICE_INVALID_OPERATION_REF` | [send-task-webservice-invalid-operation-ref](send-task-webservice-invalid-operation-ref.md) |
| `SCRIPT_TASK_MISSING_SCRIPT` | [script-task-missing-script](script-task-missing-script.md) |
| `MAIL_TASK_NO_RECIPIENT` | [mail-task-no-recipient](mail-task-no-recipient.md) |
| `MAIL_TASK_NO_CONTENT` | [mail-task-no-content](mail-task-no-content.md) |
| `SHELL_TASK_NO_COMMAND` | [shell-task-no-command](shell-task-no-command.md) |
| `SHELL_TASK_INVALID_PARAM` | [shell-task-invalid-param](shell-task-invalid-param.md) |
| `DMN_TASK_NO_KEY` | [dmn-task-no-key](dmn-task-no-key.md) |
| `EXCLUSIVE_GATEWAY_NO_OUTGOING_SEQ_FLOW` | [exclusive-gateway-no-outgoing-seq-flow](exclusive-gateway-no-outgoing-seq-flow.md) |
| `EXCLUSIVE_GATEWAY_CONDITION_NOT_ALLOWED_ON_SINGLE_SEQ_FLOW` | [exclusive-gateway-condition-not-allowed-on-single-seq-flow](exclusive-gateway-condition-not-allowed-on-single-seq-flow.md) |
| `EXCLUSIVE_GATEWAY_CONDITION_ON_DEFAULT_SEQ_FLOW` | [exclusive-gateway-condition-on-default-seq-flow](exclusive-gateway-condition-on-default-seq-flow.md) |
| `EXCLUSIVE_GATEWAY_SEQ_FLOW_WITHOUT_CONDITIONS` | [exclusive-gateway-seq-flow-without-conditions](exclusive-gateway-seq-flow-without-conditions.md) |
| `EVENT_GATEWAY_ONLY_CONNECTED_TO_INTERMEDIATE_EVENTS` | [event-gateway-only-connected-to-intermediate-events](event-gateway-only-connected-to-intermediate-events.md) |
| `BPMN_MODEL_TARGET_NAMESPACE_TOO_LONG` | [bpmn-model-target-namespace-too-long](bpmn-model-target-namespace-too-long.md) |
| `PROCESS_DEFINITION_ID_NOT_UNIQUE` | [process-definition-id-not-unique](process-definition-id-not-unique.md) |
| `PROCESS_DEFINITION_ID_TOO_LONG` | [process-definition-id-too-long](process-definition-id-too-long.md) |
| `PROCESS_DEFINITION_NAME_TOO_LONG` | [process-definition-name-too-long](process-definition-name-too-long.md) |
| `PROCESS_DEFINITION_DOCUMENTATION_TOO_LONG` | [process-definition-documentation-too-long](process-definition-documentation-too-long.md) |
| `FLOW_ELEMENT_ID_TOO_LONG` | [flow-element-id-too-long](flow-element-id-too-long.md) |
| `SUBPROCESS_MULTIPLE_START_EVENTS` | [subprocess-multiple-start-events](subprocess-multiple-start-events.md) |
| `SUBPROCESS_START_EVENT_EVENT_DEFINITION_NOT_ALLOWED` | [subprocess-start-event-event-definition-not-allowed](subprocess-start-event-event-definition-not-allowed.md) |
| `EVENT_SUBPROCESS_INVALID_START_EVENT_DEFINITION` | [event-subprocess-invalid-start-event-definition](event-subprocess-invalid-start-event-definition.md) |
| `BOUNDARY_EVENT_NO_EVENT_DEFINITION` | [boundary-event-no-event-definition](boundary-event-no-event-definition.md) |
| `BOUNDARY_EVENT_INVALID_EVENT_DEFINITION` | [boundary-event-invalid-event-definition](boundary-event-invalid-event-definition.md) |
| `BOUNDARY_EVENT_CANCEL_ONLY_ON_TRANSACTION` | [boundary-event-cancel-only-on-transaction](boundary-event-cancel-only-on-transaction.md) |
| `BOUNDARY_EVENT_MULTIPLE_CANCEL_ON_TRANSACTION` | [boundary-event-multiple-cancel-on-transaction](boundary-event-multiple-cancel-on-transaction.md) |
| `INTERMEDIATE_CATCH_EVENT_NO_EVENTDEFINITION` | [intermediate-catch-event-no-eventdefinition](intermediate-catch-event-no-eventdefinition.md) |
| `INTERMEDIATE_CATCH_EVENT_INVALID_EVENTDEFINITION` | [intermediate-catch-event-invalid-eventdefinition](intermediate-catch-event-invalid-eventdefinition.md) |
| `ERROR_MISSING_ERROR_CODE` | [error-missing-error-code](error-missing-error-code.md) |
| `EVENT_TIMER_MISSING_CONFIGURATION` | [event-timer-missing-configuration](event-timer-missing-configuration.md) |
| `THROW_EVENT_INVALID_EVENTDEFINITION` | [throw-event-invalid-eventdefinition](throw-event-invalid-eventdefinition.md) |
| `MULTI_INSTANCE_MISSING_COLLECTION` | [multi-instance-missing-collection](multi-instance-missing-collection.md) |
| `MESSAGE_INVALID_ITEM_REF` | [message-invalid-item-ref](message-invalid-item-ref.md) |
| `MESSAGE_EVENT_MISSING_MESSAGE_REF` | [message-event-missing-message-ref](message-event-missing-message-ref.md) |
| `MESSAGE_EVENT_INVALID_MESSAGE_REF` | [message-event-invalid-message-ref](message-event-invalid-message-ref.md) |
| `MESSAGE_EVENT_MULTIPLE_ON_BOUNDARY_SAME_MESSAGE_ID` | [message-event-multiple-on-boundary-same-message-id](message-event-multiple-on-boundary-same-message-id.md) |
| `OPERATION_INVALID_IN_MESSAGE_REFERENCE` | [operation-invalid-in-message-reference](operation-invalid-in-message-reference.md) |
| `SIGNAL_EVENT_MISSING_SIGNAL_REF` | [signal-event-missing-signal-ref](signal-event-missing-signal-ref.md) |
| `SIGNAL_EVENT_INVALID_SIGNAL_REF` | [signal-event-invalid-signal-ref](signal-event-invalid-signal-ref.md) |
| `COMPENSATE_EVENT_INVALID_ACTIVITY_REF` | [compensate-event-invalid-activity-ref](compensate-event-invalid-activity-ref.md) |
| `COMPENSATE_EVENT_MULTIPLE_ON_BOUNDARY` | [compensate-event-multiple-on-boundary](compensate-event-multiple-on-boundary.md) |
| `SIGNAL_MISSING_ID` | [signal-missing-id](signal-missing-id.md) |
| `SIGNAL_MISSING_NAME` | [signal-missing-name](signal-missing-name.md) |
| `SIGNAL_DUPLICATE_NAME` | [signal-duplicate-name](signal-duplicate-name.md) |
| `SIGNAL_INVALID_SCOPE` | [signal-invalid-scope](signal-invalid-scope.md) |
| `DATA_ASSOCIATION_MISSING_TARGETREF` | [data-association-missing-targetref](data-association-missing-targetref.md) |
| `DATA_OBJECT_MISSING_NAME` | [data-object-missing-name](data-object-missing-name.md) |
| `END_EVENT_CANCEL_ONLY_INSIDE_TRANSACTION` | [end-event-cancel-only-inside-transaction](end-event-cancel-only-inside-transaction.md) |
| `DI_INVALID_REFERENCE` | [di-invalid-reference](di-invalid-reference.md) |
| `DI_DOES_NOT_REFERENCE_FLOWNODE` | [di-does-not-reference-flownode](di-does-not-reference-flownode.md) |
| `DI_DOES_NOT_REFERENCE_SEQ_FLOW` | [di-does-not-reference-seq-flow](di-does-not-reference-seq-flow.md) |
| `FLOW_ELEMENT_ASYNC_NOT_AVAILABLE` | [flow-element-async-not-available](flow-element-async-not-available.md) |
| `EVENT_TIMER_ASYNC_NOT_AVAILABLE` | [event-timer-async-not-available](event-timer-async-not-available.md) |
| `SIGNAL_ASYNC_NOT_AVAILABLE` | [signal-async-not-available](signal-async-not-available.md) |
| `LINK_EVENT_DEFINITION_MISSING_TARGET` | [link-event-definition-missing-target](link-event-definition-missing-target.md) |
| `LINK_EVENT_DEFINITION_MISSING_TARGET_EMPTY_NAME` | [link-event-definition-missing-target-empty-name](link-event-definition-missing-target-empty-name.md) |
| `LINK_EVENT_DEFINITION_MISSING_SOURCE` | [link-event-definition-missing-source](link-event-definition-missing-source.md) |
| `LINK_EVENT_DEFINITION_MISSING_SOURCE_EMPTY_NAME` | [link-event-definition-missing-source-empty-name](link-event-definition-missing-source-empty-name.md) |

## Where the problems appear

See [Problems panel](../modeler-basics.md#problems-panel) for the panel, the status bar counters and the canvas markers, and the [developer guide](../../developer-guide.md#lint-and-the-problems-panel) for `lintProject()` and the focus event.

## Command line

The same rules run outside the browser, for CI and the corpus checks:

```
activiti-lint <project-folder>...     # processes/, connectors/ and the DMN files of a project
activiti-lint <corpus> --seeds        # the seed folder of every project below a corpus folder
```

Options: `--json`, `--quiet` (errors only), `--max-warnings <n>`, `--ignore <rule>` (repeatable), `--kie` (lint DMN for the KIE engine), `--async-off` (the engine runs without an async executor), `--script-engine <name>` (a JSR-223 engine the application provides), `--list-rules`. The exit status is 1 when a project has an error (or more warnings than `--max-warnings`), 2 for a wrong command line. In the repository: `npm run lint:corpus -w @activiti-modeler/bpmnlint-plugin-activiti`.
