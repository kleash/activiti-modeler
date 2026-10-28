# undeclared-qname-prefix

**A prefixed QName value whose prefix is not declared**

| | |
|---|---|
| Rule | `activiti/undeclared-qname-prefix` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

`itemSubjectRef="xsd:string"` needs `xmlns:xsd`. With the prefix undeclared the Activiti parser rejects the whole deployment (`UndeclaredPrefix`) and the modeler refuses to export. Checked attributes: `itemSubjectRef` (data objects), `structureRef` (item definitions), `typeRef`.

Evidence: [ADR 0003 guarantee 6](../../adr/), verify.ts UNDECLARED_PREFIX.

## How to fix

Declare the prefix on the definitions (`xmlns:xsd="http://www.w3.org/2001/XMLSchema"`).

## Example

Reported:

```xml
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="urn:t"><process id="p" isExecutable="true"><dataObject id="o" name="amount" itemSubjectRef="xsd:int"/></process></definitions>
```

Accepted:

```xml
<!-- process -->
<dataObject id="o" name="amount" itemSubjectRef="xsd:int"/>
```

[All lint rules](index.md)
