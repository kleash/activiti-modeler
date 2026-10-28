# link-event-definition-missing-target-empty-name

**A link throw event has no target (the event has no name)**

| | |
|---|---|
| Rule | `activiti/link-event-definition-missing-target-empty-name` |
| Severity | error |
| Engine problem key | `LINK_EVENT_DEFINITION_MISSING_TARGET_EMPTY_NAME` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

A link throw event jumps to the catch event named by its `<target>`; a link catch event lists the throw events that jump to it with `<source>`. Activiti reports an event without a name under this separate key.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §3.2](../../research/activiti-9-bpmn-support.md).

## How to fix

Pick the catching link event in **Link > Target**.

## Example

Reported:

```xml
<!-- process -->
<intermediateThrowEvent id="l"><linkEventDefinition id="ld" name="x"/></intermediateThrowEvent>
```

Accepted:

```xml
<!-- process -->
<intermediateThrowEvent id="a" name="Jump"><linkEventDefinition id="ta" name="x"><target>tb</target></linkEventDefinition></intermediateThrowEvent><intermediateCatchEvent id="b" name="Land"><linkEventDefinition id="tb" name="x"><source>ta</source></linkEventDefinition></intermediateCatchEvent>
```

[All lint rules](index.md)
