# process-definition-id-too-long

**The process id is longer than 255 characters**

| | |
|---|---|
| Rule | `activiti/process-definition-id-too-long` |
| Severity | error |
| Engine problem key | `PROCESS_DEFINITION_ID_TOO_LONG` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

Activiti rejects the deployment: id of a process is limited to 255 characters (the definition key column). Only evaluated when the file has an executable process.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Shorten the value.

## Example

Reported:

```xml
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="urn:t"><process id="pppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp" isExecutable="true"/></definitions>
```

Accepted:

```xml
<!-- process -->

```

[All lint rules](index.md)
