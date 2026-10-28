# process-definition-id-not-unique

**Two processes in the file have the same id**

| | |
|---|---|
| Rule | `activiti/process-definition-id-not-unique` |
| Severity | error |
| Engine problem key | `PROCESS_DEFINITION_ID_NOT_UNIQUE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Reads | the file as written |

## Why it matters

The process id is the process definition key. Activiti only detects a duplicate among processes that have a name.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Give every process its own id (**General > ID**).

## Example

Reported:

```xml
<!-- process -->


<!-- also in the file -->
<process id="p" name="B" isExecutable="true"/>
```

Accepted:

```xml
<!-- process -->


<!-- also in the file -->
<process id="q" name="B" isExecutable="true"/>
```

[All lint rules](index.md)
