# no-web-service-task

**A web service task (implementation ##WebService)**

| | |
|---|---|
| Rule | `activiti/no-web-service-task` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |

## Why it matters

The importer class of the web service behaviour (`CxfWSDLImporter`) is in no Activiti 9.0.0 jar.

Evidence: [R1 §0.1-9](../../research/activiti-9-bpmn-support.md), [engine run t47](../../engine-findings.md).

## How to fix

Call the service from a connector or a Java class.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="w" implementation="##WebService"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="w" implementation="crm.LOOKUP"/>
```

[All lint rules](index.md)
