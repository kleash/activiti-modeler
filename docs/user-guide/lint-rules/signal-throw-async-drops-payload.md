# signal-throw-async-drops-payload

**An asynchronous signal throw**

| | |
|---|---|
| Rule | `activiti/signal-throw-async-drops-payload` |
| Severity | info |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

An asynchronous signal creates an event job that stores only the subscription id: the payload (the variables the signal carries) is dropped (the source says "TODO: support payload"). The job also needs the async executor.

Evidence: [engine-findings 35](../../engine-findings.md).

## How to fix

Throw the signal synchronously when the catcher needs the variables.

## Example

Reported:

```xml
<!-- definitions -->
<signal id="sg" name="go"/>

<!-- process -->
<intermediateThrowEvent id="t"><signalEventDefinition signalRef="sg" activiti:async="true"/></intermediateThrowEvent>
```

Accepted:

```xml
<!-- definitions -->
<signal id="sg" name="go"/>

<!-- process -->
<intermediateThrowEvent id="t"><signalEventDefinition signalRef="sg"/></intermediateThrowEvent>
```

[All lint rules](index.md)
