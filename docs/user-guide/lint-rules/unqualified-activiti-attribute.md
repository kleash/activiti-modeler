# unqualified-activiti-attribute

**An Activiti attribute written without the activiti: prefix in the file**

| | |
|---|---|
| Rule | `activiti/unqualified-activiti-attribute` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |
| Reads | the file as written |

## Why it matters

Activiti reads attributes such as `assignee`, `class` or `async` only in the `activiti:` namespace. Written without the prefix they fail the XSD or are ignored. The editor reads such an attribute as the Activiti one and writes it with the prefix, so saving fixes the file; until then the file as it is on disk does not do what it says.

Evidence: [R1 §2.3](../../research/activiti-9-bpmn-support.md), verify.ts UNQUALIFIED_ACTIVITI_ATTRIBUTE.

## How to fix

Save the file from the modeler, or write `activiti:assignee` in the XML.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u" assignee="kermit"/>
```

Accepted:

```xml
<!-- process -->
<userTask id="u" activiti:assignee="kermit"/><sequenceFlow id="f" sourceRef="u" targetRef="u" skipExpression="${true}"/>
```

[All lint rules](index.md)
