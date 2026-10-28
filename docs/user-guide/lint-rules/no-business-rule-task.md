# no-business-rule-task

**A business rule task**

| | |
|---|---|
| Rule | `activiti/no-business-rule-task` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |
| Quick fix | Convert to a Decision task |

## Why it matters

Activiti 9 has no rules engine behind `businessRuleTask`. Without an `activiti:class` the engine throws a NullPointerException while it parses the process, so the deployment fails. A Camunda `camunda:decisionRef` is not read either.

Evidence: [R1 §0.1-2](../../research/activiti-9-bpmn-support.md), [engine run t04](../../engine-findings.md), [FEATURE_MATRIX §C](../../FEATURE_MATRIX.md).

## How to fix

Convert it to a **Decision task** (a service task that calls `dmn-connector.EXECUTE_TABLE`) and pick the decision. The quick fix does the conversion.

## Example

Reported:

```xml
<!-- process -->
<businessRuleTask id="b"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="b" implementation="dmn-connector.EXECUTE_TABLE"/>
```

[All lint rules](index.md)
