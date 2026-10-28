# multi-instance-minified-xml

**The closing tag of a multi-instance activity follows its loop element without a line break**

| | |
|---|---|
| Rule | `activiti/multi-instance-minified-xml` |
| Severity | error |
| Kind | Extra rule L16 (FEATURE_MATRIX §D) |
| Reads | the file as written |

## Why it matters

The Activiti parser unconditionally consumes one more XML event after `</multiInstanceLoopCharacteristics>`. When that event is the closing tag of the activity (minified XML), the tag is swallowed and every following flow element is absorbed into the task: the process deploys, has no sequence flows, and ends immediately at start without an error. The modeler's serializer always puts a line break there.

Evidence: [R1 §0.2-14](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L16](../../research/activiti-9-bpmn-support.md), [ADR 0003 guarantee 2](../../adr/).

## How to fix

Save the file from the modeler, or put a line break after `</multiInstanceLoopCharacteristics>`.

## Example

Reported:

```xml
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p" isExecutable="true"><userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics></userTask><endEvent id="e"/></process></definitions>
```

Accepted:

```xml
<!-- process -->
<userTask id="u">
<multiInstanceLoopCharacteristics><loopCardinality>2</loopCardinality></multiInstanceLoopCharacteristics>
</userTask>
```

[All lint rules](index.md)
