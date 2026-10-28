# error-boundary-non-interrupting

**cancelActivity="false" on an error boundary event**

| | |
|---|---|
| Rule | `activiti/error-boundary-non-interrupting` |
| Severity | info |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The converter forces `cancelActivity=false` for error boundary events whatever the XML says and executes them as an interrupting error catch. The flag means nothing.

Evidence: [engine-findings C08.5](../../engine-findings.md), [R1 §3.2](../../research/activiti-9-bpmn-support.md).

## How to fix

Remove the flag.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b" attachedToRef="t" cancelActivity="false"><errorEventDefinition/></boundaryEvent>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><boundaryEvent id="b" attachedToRef="t"><errorEventDefinition/></boundaryEvent>
```

[All lint rules](index.md)
