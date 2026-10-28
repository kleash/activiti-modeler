# process-definition-name-too-long

**The process name is longer than 255 characters**

| | |
|---|---|
| Rule | `activiti/process-definition-name-too-long` |
| Severity | error |
| Engine problem key | `PROCESS_DEFINITION_NAME_TOO_LONG` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti rejects the deployment: the process name is limited to 255 characters. Only evaluated when the file has an executable process.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Shorten the value.

## Example

Reported:

```xml
<!-- process -->

```

Accepted:

```xml
<!-- process -->

```

[All lint rules](index.md)
