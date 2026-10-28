# dmn-unsupported-on-operaton

**A DMN construct only the KIE engine can evaluate (business knowledge model, boxed context, invocation, ...)**

| | |
|---|---|
| Rule | `activiti/dmn-unsupported-on-operaton` |
| Severity | error |
| Kind | Extra rule L29 (FEATURE_MATRIX §D) |

## Why it matters

The default evaluator (Operaton) runs decision tables and literal expressions. Business knowledge models, boxed contexts, invocations, relations, functions and decision services need `activiti.dmn.engine=kie`; on Operaton the connector fails with a clear error naming the decision.

Evidence: [docs/user-guide/dmn-conventions.md](../dmn-conventions.md), [ADR 0004](../../adr/).

## How to fix

Rewrite the decision as a decision table or literal expression, or select the KIE profile (`dmnProfile: "kie"`) and add `activiti-dmn-connector-kie` to the application.

## Example

Reported:

```xml
<!-- processes/k.dmn -->
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="defs" namespace="urn:defs"><decision id="d1" name="d1"><variable id="d1_v" name="d1" typeRef="string"/><context id="ctx"><contextEntry><literalExpression><text>1</text></literalExpression></contextEntry></context></decision></definitions>
```

Accepted:

```xml
<!-- processes/k.dmn -->
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="defs" namespace="urn:defs"><decision id="d1" name="d1"><variable id="d1_v" name="d1" typeRef="string"/><literalExpression id="lit"><text>1</text></literalExpression></decision></definitions>
```

[All lint rules](index.md)
