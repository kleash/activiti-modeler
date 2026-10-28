# dmn-output-without-name

**A decision table output column has no name**

| | |
|---|---|
| Rule | `activiti/dmn-output-without-name` |
| Severity | error |
| Kind | Extra rule L33 (FEATURE_MATRIX §D) |

## Why it matters

The connector hands a column value to the process under the column's `name`; a column without one fails the decision with `output column ... has no name` (ADR 0004).

Evidence: [docs/user-guide/dmn-conventions.md](../dmn-conventions.md), [ADR 0004](../../adr/).

## How to fix

Give every output column a name in the decision table editor.

## Example

Reported:

```xml
<!-- processes/t.dmn -->
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="defs" namespace="urn:defs"><decision id="d1" name="d1"><variable id="d1_v" name="d1" typeRef="string"/><decisionTable id="t" hitPolicy="UNIQUE"><input id="i"><inputExpression typeRef="number"><text>x</text></inputExpression></input><output id="o" typeRef="string"/></decisionTable></decision></definitions>
```

Accepted:

```xml
<!-- processes/t.dmn -->
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="defs" namespace="urn:defs"><decision id="d1" name="d1"><variable id="d1_v" name="d1" typeRef="string"/><decisionTable id="t" hitPolicy="UNIQUE"><input id="i"><inputExpression typeRef="number"><text>x</text></inputExpression></input><output id="o" name="grade" typeRef="string"/></decisionTable></decision></definitions>
```

[All lint rules](index.md)
