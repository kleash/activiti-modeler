# process-definition-not-executable

**A process is not executable while another one in the file is**

| | |
|---|---|
| Rule | `activiti/process-definition-not-executable` |
| Severity | warning |
| Engine problem key | `PROCESS_DEFINITION_NOT_EXECUTABLE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Quick fix | Make the process executable |

## Why it matters

Activiti deploys the executable processes and ignores the others, so this process never runs (L15).

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L15](../../research/activiti-9-bpmn-support.md).

## How to fix

Set **Executable** on the process, or move it to a file of its own if it is documentation only.

## Example

Reported:

```xml
<!-- process -->


<!-- also in the file -->
<process id="q" isExecutable="true"/>
```

Accepted:

```xml
<!-- process -->


<!-- also in the file -->
<process id="q" isExecutable="true"/>
```

[All lint rules](index.md)
