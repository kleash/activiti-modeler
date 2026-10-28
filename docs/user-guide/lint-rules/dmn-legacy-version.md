# dmn-legacy-version

**A DMN 1.1 or 1.2 file**

| | |
|---|---|
| Rule | `activiti/dmn-legacy-version` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

Both engines load older DMN, but dmn-js 18 and the KIE engine are written against 1.3. The modeler migrates the file when it opens it (`@bpmn-io/dmn-migrate`) and writes 1.3 on save.

Evidence: [docs/user-guide/dmn-conventions.md](../dmn-conventions.md), [FEATURE_MATRIX DM9](../../FEATURE_MATRIX.md).

## How to fix

Open the file in the DMN editor and save it.

## Example

Reported:

```xml
<!-- processes/old.dmn -->
<definitions xmlns="http://www.omg.org/spec/DMN/20151101/dmn.xsd" id="old" name="old" namespace="urn:old"><decision id="d1" name="d1"><decisionTable id="t"><input id="i"><inputExpression><text>x</text></inputExpression></input><output id="o" name="y"/></decisionTable></decision></definitions>
```

Accepted:

```xml
<!-- processes/t.dmn -->
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="defs" namespace="urn:defs"><decision id="d1" name="d1"><variable id="d1_v" name="d1" typeRef="string"/><literalExpression id="lit"><text>1</text></literalExpression></decision></definitions>
```

[All lint rules](index.md)
