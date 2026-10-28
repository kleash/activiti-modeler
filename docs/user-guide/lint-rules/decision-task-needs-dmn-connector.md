# decision-task-needs-dmn-connector

**A decision task, which needs the DMN connector in the application**

| | |
|---|---|
| Rule | `activiti/decision-task-needs-dmn-connector` |
| Severity | info |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

Activiti 7 and later have no DMN engine. A decision task calls the connector bean `dmn-connector.EXECUTE_TABLE`, which the library `io.github.kleash.activiti:activiti-dmn-connector` provides. The modeler server includes it. An application without it deploys the process and fails when the task is reached, with `NoSuchBeanDefinitionException`, as for any connector bean that is missing. The DMN files are deployed with the processes only when `**.dmn` is in `spring.activiti.process-definition-location-suffixes`.

Evidence: [ADR 0004](../../adr/), [R1 §6.1](../../research/activiti-9-bpmn-support.md), [engine-findings 24](../../engine-findings.md).

## How to fix

Add the dependency `io.github.kleash.activiti:activiti-dmn-connector` to the application that runs the process, and `**.dmn` to `spring.activiti.process-definition-location-suffixes` (the integration guide shows both). The model needs no change.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="dt" name="Decide" implementation="dmn-connector.EXECUTE_TABLE"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" implementation="crm.LOOKUP"/>
```

[All lint rules](index.md)
