# map-exception-ignored

**mapException on an element where Activiti does not wire it**

| | |
|---|---|
| Rule | `activiti/map-exception-ignored` |
| Severity | warning |
| Kind | Extra rule L32 (FEATURE_MATRIX §D) |

## Why it matters

Exception mapping is wired only for service tasks that run a Java class (`activiti:class`) and for call activities. On a delegate expression, a connector, an expression or any other element the entries are parsed and never used: the Java exception rolls the call back instead of becoming a BPMN error.

Evidence: [R1 §7.1 L32](../../research/activiti-9-bpmn-support.md), [engine-findings C08.6](../../engine-findings.md), [FEATURE_MATRIX T15b](../../FEATURE_MATRIX.md).

## How to fix

Use an `activiti:class` service task, or throw a `BpmnError` from the delegate or connector.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" activiti:delegateExpression="${bean}"><extensionElements><activiti:mapException errorCode="E1" includeChildExceptions="true">java.lang.Exception</activiti:mapException></extensionElements></serviceTask>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:class="a.B"><extensionElements><activiti:mapException errorCode="E1">java.lang.Exception</activiti:mapException></extensionElements></serviceTask>
```

[All lint rules](index.md)
