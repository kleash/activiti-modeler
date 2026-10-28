# loop-data-ref-not-variable-name

**A multi-instance loopDataInputRef / loopDataOutputRef that is not a variable name**

| | |
|---|---|
| Rule | `activiti/loop-data-ref-not-variable-name` |
| Severity | error |
| Kind | Extra rule L35 (FEATURE_MATRIX §D) |

## Why it matters

BPMN says these are references to data inputs and outputs; Activiti reads the element text as the **name of a process variable**. Anything that is not a plain name (an id with a dash, an expression, a path) never resolves.

Evidence: [FEATURE_MATRIX T16](../../FEATURE_MATRIX.md), [FEATURE_MATRIX §D L35](../../FEATURE_MATRIX.md), [engine-findings 3](../../engine-findings.md).

## How to fix

Write the variable name in the **Collection** / **Output collection** field.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u"><multiInstanceLoopCharacteristics><loopDataInputRef>people-list</loopDataInputRef></multiInstanceLoopCharacteristics></userTask>
```

Accepted:

```xml
<!-- process -->
<userTask id="u"><multiInstanceLoopCharacteristics><loopDataInputRef>people</loopDataInputRef><loopDataOutputRef>results</loopDataOutputRef></multiInstanceLoopCharacteristics></userTask>
```

[All lint rules](index.md)
