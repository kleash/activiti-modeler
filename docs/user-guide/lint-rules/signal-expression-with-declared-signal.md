# signal-expression-with-declared-signal

**A signal named by an expression in a file that declares signals**

| | |
|---|---|
| Rule | `activiti/signal-expression-with-declared-signal` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

When a file declares any `<signal>`, parsing an event named by `activiti:signalExpression` fails with a NullPointerException ("Error parsing XML"), for catch, throw and boundary events alike. The same file deploys when it declares no signal; the expression-named signal is then always global.

Evidence: [engine-findings 28](../../engine-findings.md).

## How to fix

Name the signal with `signalRef` and remove the expression, or remove the `<signal>` definitions of the file.

## Example

Reported:

```xml
<!-- definitions -->
<signal id="sg" name="go"/>

<!-- process -->
<intermediateCatchEvent id="c"><signalEventDefinition activiti:signalExpression="${name}"/></intermediateCatchEvent>
```

Accepted:

```xml
<!-- process -->
<intermediateCatchEvent id="c"><signalEventDefinition activiti:signalExpression="${name}"/></intermediateCatchEvent>
```

[All lint rules](index.md)
