# message-definition-field-ignored

**An activiti:field on a message event definition**

| | |
|---|---|
| Rule | `activiti/message-definition-field-ignored` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The fields are parsed but the throw delegates are created with an empty field list: a field of the delegate stays null. Only the input mapping of the throw event reaches the delegate (as `ThrowMessage.payload`).

Evidence: [engine-findings 33](../../engine-findings.md).

## How to fix

Pass the data through the throw event's input mapping instead.

## Example

Reported:

```xml
<!-- definitions -->
<message id="m" name="m"/>

<!-- process -->
<intermediateThrowEvent id="t"><messageEventDefinition messageRef="m"><extensionElements><activiti:field name="to"><activiti:string>x</activiti:string></activiti:field></extensionElements></messageEventDefinition></intermediateThrowEvent>
```

Accepted:

```xml
<!-- definitions -->
<message id="m" name="m"/>

<!-- process -->
<intermediateThrowEvent id="t"><messageEventDefinition messageRef="m"/></intermediateThrowEvent>
```

[All lint rules](index.md)
