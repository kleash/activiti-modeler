# mail-task-without-from

**A mail task without a "from" field**

| | |
|---|---|
| Rule | `activiti/mail-task-without-from` |
| Severity | info |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The sender is the `from` field or else the engine's default from address (`spring.activiti.mail-server-default-from`); with neither, the task fails with a NullPointerException in `setFrom`.

Evidence: [engine-findings C14.1](../../engine-findings.md), [R1 §3.3](../../research/activiti-9-bpmn-support.md).

## How to fix

Add a `from` field, or configure the default from address of the application.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="m" activiti:type="mail"><extensionElements><activiti:field name="to"><activiti:string>a@b.c</activiti:string></activiti:field></extensionElements></serviceTask>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="m" activiti:type="mail"><extensionElements><activiti:field name="from"><activiti:string>x@y.z</activiti:string></activiti:field></extensionElements></serviceTask>
```

[All lint rules](index.md)
