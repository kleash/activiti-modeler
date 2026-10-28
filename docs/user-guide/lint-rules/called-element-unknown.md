# called-element-unknown

**A call activity calls a process that is not in the project**

| | |
|---|---|
| Rule | `activiti/called-element-unknown` |
| Severity | warning |
| Kind | Extra rule L25 (FEATURE_MATRIX §D) |
| Reads | the other files of the project |

## Why it matters

The called process must be deployed with this one (or exist in the engine). If no file of the project defines a process with that key the call fails at run time with "no processes deployed with key".

Evidence: [R1 §4.6](../../research/activiti-9-bpmn-support.md), [FEATURE_MATRIX §D L25](../../FEATURE_MATRIX.md).

## How to fix

Add the process to the project, fix the key, or ignore the warning if the process is deployed elsewhere.

## Example

Reported:

```xml
<!-- process -->
<callActivity id="c" calledElement="child"/>
```

Accepted:

```xml
<!-- process -->
<callActivity id="c" calledElement="other"/>
```

[All lint rules](index.md)
