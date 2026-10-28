# data-object-type-unknown

**A data object of a type Activiti does not know**

| | |
|---|---|
| Rule | `activiti/data-object-type-unknown` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

Data objects support xsd:string, xsd:int, xsd:long, xsd:double, xsd:boolean and xsd:datetime (any prefix, the local part is matched). For another type the engine logs an error and drops the data object, so the variable never exists.

Evidence: [R1 §3.9](../../research/activiti-9-bpmn-support.md), [engine-findings C15.6](../../engine-findings.md).

## How to fix

Choose one of the listed types in the **Data object** group.

## Example

Reported:

```xml
<!-- process -->
<dataObject id="d1" name="amount" itemSubjectRef="xsd:decimal"/>
```

Accepted:

```xml
<!-- process -->
<dataObject id="d1" name="amount" itemSubjectRef="xsd:int"/><dataObject id="d2" name="note"/>
```

[All lint rules](index.md)
