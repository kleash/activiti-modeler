# dmn-unreadable

**A DMN file is not a DMN definitions document**

| | |
|---|---|
| Rule | `activiti/dmn-unreadable` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The decision task cannot find a decision in it and the connector fails when the task runs.

Evidence: [docs/user-guide/dmn-conventions.md](../dmn-conventions.md).

## How to fix

Fix the XML or recreate the file in the DMN editor.

## Example

Reported:

```xml
<!-- processes/bad.dmn -->
<oops>
```

Accepted:

```xml
<!-- processes/t.dmn -->
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="defs" name="defs" namespace="urn:defs"><decision id="d1" name="d1"><variable id="d1_v" name="d1" typeRef="string"/><literalExpression id="lit"><text>1</text></literalExpression></decision></definitions>
```

[All lint rules](index.md)
