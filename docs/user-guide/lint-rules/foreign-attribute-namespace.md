# foreign-attribute-namespace

**An attribute from a namespace the serializer does not allow**

| | |
|---|---|
| Rule | `activiti/foreign-attribute-namespace` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |
| Quick fix | Remove the attribute |

## Why it matters

ADR 0003 allows only `activiti:` attributes (plus the `bioc:` and `color:` colours and the diagram namespaces) on BPMN elements. Anything else is preserved on import but makes the export refuse the file, so it cannot be saved until it is removed. Camunda Modeler adds `modeler:executionPlatform` to every definitions element (reported as a Camunda extension).

Evidence: [ADR 0003 guarantee 5](../../adr/), verify.ts FOREIGN_ATTRIBUTE.

## How to fix

Remove the attribute in the XML view.

## Example

Reported:

```xml
<!-- process -->
<task id="t" xmlns:acme="urn:acme" acme:flag="1"/>
```

Accepted:

```xml
<!-- process -->
<task id="t" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" bioc:stroke="#000"/>
```

[All lint rules](index.md)
