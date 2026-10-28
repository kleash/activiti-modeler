# compensate-wait-for-completion-ignored

**waitForCompletion="false" on a compensation throw event**

| | |
|---|---|
| Rule | `activiti/compensate-wait-for-completion-ignored` |
| Severity | info |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The attribute is parsed and ignored: asynchronous compensation is a TODO in the engine, the handlers run to completion before the process moves on.

Evidence: [engine-findings C08.3](../../engine-findings.md).

## How to fix

Remove the attribute.

## Example

Reported:

```xml
<!-- process -->
<intermediateThrowEvent id="t"><compensateEventDefinition waitForCompletion="false"/></intermediateThrowEvent>
```

Accepted:

```xml
<!-- process -->
<intermediateThrowEvent id="t"><compensateEventDefinition/></intermediateThrowEvent>
```

[All lint rules](index.md)
