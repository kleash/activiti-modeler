# signal-duplicate-name

**Two signal definitions have the same name**

| | |
|---|---|
| Rule | `activiti/signal-duplicate-name` |
| Severity | error |
| Engine problem key | `SIGNAL_DUPLICATE_NAME` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Signal names are unique per file; two definitions of one name make the reference ambiguous.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Rename or delete one of the signals.

## Example

Reported:

```xml
<!-- definitions -->
<signal id="s1" name="go"/><signal id="s2" name="go"/>

<!-- process -->

```

Accepted:

```xml
<!-- definitions -->
<signal id="s1" name="go"/><signal id="s2" name="stop"/>

<!-- process -->

```

[All lint rules](index.md)
