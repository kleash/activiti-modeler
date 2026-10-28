# connector-template-outdated

**A connector task uses an older version of its template**

| | |
|---|---|
| Rule | `activiti/connector-template-outdated` |
| Severity | warning |
| Kind | Extra rule L36 (FEATURE_MATRIX §D) |
| Reads | the other files of the project |

## Why it matters

Applying a connector template records the template id and version on the element (`activiti:templateId`, `activiti:templateVersion`). When the version of the connector (`project.json`, `connectors.<name>.version`) is newer, the task's inputs and outputs may no longer match it.

Evidence: [FEATURE_MATRIX §D L36](../../FEATURE_MATRIX.md).

## How to fix

Update the task from the template (**Update** in the template banner of the properties panel).

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" name="x" implementation="crm.LOOKUP" activiti:templateId="crm" activiti:templateVersion="1"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" name="x" implementation="crm.LOOKUP" activiti:templateId="crm" activiti:templateVersion="2"/>
```

[All lint rules](index.md)
