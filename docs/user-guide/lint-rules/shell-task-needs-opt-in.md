# shell-task-needs-opt-in

**A shell task**

| | |
|---|---|
| Rule | `activiti/shell-task-needs-opt-in` |
| Severity | info |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

A shell task runs an operating system command: the modeler server rejects it at deployment unless `modeler.server.allow-shell-tasks=true`, and a production application should not run one at all. A non-zero exit code never fails the task.

Evidence: [ADR 0007](../../adr/), [engine-findings C14.4](../../engine-findings.md).

## How to fix

Enable shell tasks on the server for development, or call the program from a Java class or connector.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" activiti:type="shell"><extensionElements><activiti:field name="command"><activiti:string>ls</activiti:string></activiti:field></extensionElements></serviceTask>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" activiti:class="a.B"/>
```

[All lint rules](index.md)
