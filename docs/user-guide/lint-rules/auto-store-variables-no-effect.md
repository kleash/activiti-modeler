# auto-store-variables-no-effect

**autoStoreVariables on a script task**

| | |
|---|---|
| Rule | `activiti/auto-store-variables-no-effect` |
| Severity | warning |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

The flag only switches how the script bindings store variables. Nashorn never calls the binding for a global assignment or a `var` declaration, and the JUEL script engine cannot assign at all, so the flag does nothing with the bundled script languages.

Evidence: [engine-findings 25](../../engine-findings.md), [FEATURE_MATRIX T9](../../FEATURE_MATRIX.md).

## How to fix

Write variables with `execution.setVariable("name", value)`, or use the result variable.

## Example

Reported:

```xml
<!-- process -->
<scriptTask id="s" scriptFormat="javascript" activiti:autoStoreVariables="true"><script>x = 1</script></scriptTask>
```

Accepted:

```xml
<!-- process -->
<scriptTask id="s" scriptFormat="javascript"><script>execution.setVariable("x", 1)</script></scriptTask>
```

[All lint rules](index.md)
