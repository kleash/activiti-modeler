# error-missing-error-code

**An error definition has no errorCode**

| | |
|---|---|
| Rule | `activiti/error-missing-error-code` |
| Severity | error |
| Engine problem key | `ERROR_MISSING_ERROR_CODE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Error events are matched by error code; the validator rejects a definition without one.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Give the error a code in the Errors list.

## Example

Reported:

```xml
<!-- definitions -->
<error id="e" name="oops"/>

<!-- process -->

```

Accepted:

```xml
<!-- definitions -->
<error id="e" name="oops" errorCode="E1"/>

<!-- process -->

```

[All lint rules](index.md)
