# multi-instance-call-activity-output

**Output from a multi-instance call activity**

| | |
|---|---|
| Rule | `activiti/multi-instance-call-activity-output` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

A multi-instance call activity gets nothing back from its children: `activiti:out`, an output mapping and the output collection are all skipped (the collection holds one null per instance).

Evidence: [engine-findings C11.1](../../engine-findings.md).

## How to fix

Write the child's result somewhere shared (a signal, a message or a service), or wrap the call in a multi-instance sub process.

## Example

Reported:

```xml
<!-- process -->
<callActivity id="c" calledElement="x"><extensionElements><activiti:out source="r" target="r"/></extensionElements><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></callActivity>
```

Accepted:

```xml
<!-- process -->
<callActivity id="c" calledElement="x"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></callActivity>
```

[All lint rules](index.md)
