# no-group

**A group**

| | |
|---|---|
| Rule | `activiti/no-group` |
| Severity | warning |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |
| Quick fix | Delete the element |

## Why it matters

The converter drops a `group`; it is documentation on the canvas only and disappears from the deployed model.

Evidence: [R1 §0.1-11](../../research/activiti-9-bpmn-support.md), [engine run t14](../../engine-findings.md).

## How to fix

Use a text annotation, or accept that the group is for the diagram only.

## Example

Reported:

```xml
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="urn:t"><category id="cat"><categoryValue id="cv" value="g"/></category><process id="p" isExecutable="true"/><collaboration id="c"><participant id="pp" processRef="p"/><group id="g" categoryValueRef="cv"/></collaboration></definitions>
```

Accepted:

```xml
<!-- process -->
<textAnnotation id="a"><text>note</text></textAnnotation>
```

[All lint rules](index.md)
