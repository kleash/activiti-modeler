# signal-invalid-scope

**A signal has a scope other than global or processInstance**

| | |
|---|---|
| Rule | `activiti/signal-invalid-scope` |
| Severity | error |
| Engine problem key | `SIGNAL_INVALID_SCOPE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

`activiti:scope` decides whether a thrown signal reaches every process instance or only the throwing one; other values are rejected.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Choose **global** or **processInstance** in the Signals list.

## Example

Reported:

```xml
<!-- definitions -->
<signal id="s" name="go" activiti:scope="everywhere"/>

<!-- process -->

```

Accepted:

```xml
<!-- definitions -->
<signal id="s" name="go" activiti:scope="processInstance"/>

<!-- process -->

```

[All lint rules](index.md)
