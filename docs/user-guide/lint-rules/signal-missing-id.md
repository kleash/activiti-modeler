# signal-missing-id

**A signal definition has no id**

| | |
|---|---|
| Rule | `activiti/signal-missing-id` |
| Severity | error |
| Engine problem key | `SIGNAL_MISSING_ID` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Events refer to a signal by its id.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Give the signal an id (the Signals list of the process does).

## Example

Reported:

```xml
<!-- definitions -->
<signal name="go"/>

<!-- process -->

```

Accepted:

```xml
<!-- definitions -->
<signal id="s" name="go"/>

<!-- process -->

```

[All lint rules](index.md)
