# bpmn-unreadable

**A BPMN file is not well-formed XML**

| | |
|---|---|
| Rule | `activiti/bpmn-unreadable` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The modeler cannot open it and Activiti rejects the deployment. The message is the parser's.

Evidence: [R1 §2.1](../../research/activiti-9-bpmn-support.md).

## How to fix

Open the file as text, fix the XML and reopen it.

## Example

Reported:

```xml
<!-- processes/a.bpmn20.xml -->
<definitions><process
```

Accepted:

```xml
<!-- processes/a.bpmn20.xml -->
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"/></definitions>
```

[All lint rules](index.md)
