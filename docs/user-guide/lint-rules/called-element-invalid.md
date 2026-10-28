# called-element-invalid

**A call activity without a valid called element**

| | |
|---|---|
| Rule | `activiti/called-element-invalid` |
| Severity | error |
| Kind | Extra rule L25 (FEATURE_MATRIX §D) |

## Why it matters

`calledElement` is the key (id) of the process to call, or an expression. Empty, it fails at run time; a key with spaces or other characters a process id cannot have never matches.

Evidence: [R1 §4.6](../../research/activiti-9-bpmn-support.md), [FEATURE_MATRIX §D L25](../../FEATURE_MATRIX.md).

## How to fix

Pick the process in the **Called element** group.

## Example

Reported:

```xml
<!-- process -->
<callActivity id="c"/>
```

Accepted:

```xml
<!-- process -->
<callActivity id="c" calledElement="child"/><callActivity id="d" calledElement="${key}"/>
```

[All lint rules](index.md)
