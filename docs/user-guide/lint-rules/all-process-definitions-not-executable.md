# all-process-definitions-not-executable

**No process of the file is executable**

| | |
|---|---|
| Rule | `activiti/all-process-definitions-not-executable` |
| Severity | error |
| Engine problem key | `ALL_PROCESS_DEFINITIONS_NOT_EXECUTABLE` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |
| Quick fix | Make the process executable |

## Why it matters

Activiti skips a process with `isExecutable="false"` without a message and refuses a file in which every process is skipped. bpmn-js writes `false` for new diagrams, so a foreign file usually has it.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md), [R1 §2.1-5](../../research/activiti-9-bpmn-support.md).

## How to fix

Set **Executable** on the process (the modeler forces it for its own diagrams).

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
