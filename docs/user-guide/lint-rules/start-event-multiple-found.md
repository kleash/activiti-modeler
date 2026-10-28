# start-event-multiple-found

**A process has more than one none start event**

| | |
|---|---|
| Rule | `activiti/start-event-multiple-found` |
| Severity | error |
| Engine problem key | `START_EVENT_MULTIPLE_FOUND` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti allows at most one start event without an event definition per process level; message, timer and signal starts may be several.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Delete the extra start event, or give it a message, timer or signal definition.

## Example

Reported:

```xml
<!-- process -->
<startEvent id="s1"/><startEvent id="s2"/>
```

Accepted:

```xml
<!-- definitions -->
<message id="m" name="m"/>

<!-- process -->
<startEvent id="s1"/><startEvent id="s2"><messageEventDefinition messageRef="m"/></startEvent>
```

[All lint rules](index.md)
