# signal-expression-catch-stale-subscription

**A signal catch event named by an expression**

| | |
|---|---|
| Rule | `activiti/signal-expression-catch-stale-subscription` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The subscription of an intermediate catch event named by `signalExpression` is removed by comparing with `signalRef`, which is null for an expression, so the execution keeps a stale subscription while it moves on. A second broadcast of the name signals whatever it waits at later: a receive task is left, a user task fails with `UserTask should not be signalled before complete`.

Evidence: [engine-findings 29](../../engine-findings.md).

## How to fix

Use a declared signal (`signalRef`) for catch events; keep expressions for throw events.

## Example

Reported:

```xml
<!-- process -->
<intermediateCatchEvent id="c"><signalEventDefinition activiti:signalExpression="${name}"/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- definitions -->
<signal id="sg" name="go"/>

<!-- process -->
<intermediateCatchEvent id="c"><signalEventDefinition signalRef="sg"/></intermediateCatchEvent>
```

[All lint rules](index.md)
