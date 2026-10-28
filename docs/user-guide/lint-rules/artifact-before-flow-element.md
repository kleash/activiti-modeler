# artifact-before-flow-element

**A text annotation or association written before a flow element**

| | |
|---|---|
| Rule | `activiti/artifact-before-flow-element` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |
| Reads | the file as written |

## Why it matters

The BPMN XSD that Activiti validates against orders a process as laneSet, flow elements, then artifacts. A text annotation or association before a later `sequenceFlow` fails the deployment with `cvc-complex-type.2.4.a: Invalid content was found starting with element 'sequenceFlow'`. The modeler writes artifacts last, so saving the file fixes it.

Evidence: [engine-findings C18.1](../../engine-findings.md), [ADR 0003 guarantee 3](../../adr/).

## How to fix

Save the file from the modeler (it re-orders the elements), or move the artifacts to the end of the process in the XML.

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><textAnnotation id="n"><text>note</text></textAnnotation><task id="u"/>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><task id="u"/><textAnnotation id="n"><text>note</text></textAnnotation><association id="a" sourceRef="t" targetRef="n"/>
```

[All lint rules](index.md)
