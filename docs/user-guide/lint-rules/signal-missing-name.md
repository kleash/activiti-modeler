# signal-missing-name

**A signal definition has no name**

| | |
|---|---|
| Rule | `activiti/signal-missing-name` |
| Severity | error |
| Engine problem key | `SIGNAL_MISSING_NAME` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The signal name is what is thrown and caught; without it the signal is unusable.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Give the signal a name in the Signals list.

## Example

Reported:

```xml
<!-- definitions -->
<signal id="s"/>

<!-- process -->

```

Accepted:

```xml
<!-- definitions -->
<signal id="s" name="go"/>

<!-- process -->

```

[All lint rules](index.md)
