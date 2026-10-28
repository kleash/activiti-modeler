# unsupported-script-format

**A script task in a language without an engine**

| | |
|---|---|
| Rule | `activiti/unsupported-script-format` |
| Severity | error |
| Kind | Construct Activiti 9 does not execute (FEATURE_MATRIX §C) |

## Why it matters

Activiti runs `juel` (the default) and `javascript` (Nashorn). Groovy and the rest need a JSR-223 engine on the application classpath: the task fails with `Can't find scripting engine for 'groovy'`.

Evidence: [R1 §8.2](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L14](../../research/activiti-9-bpmn-support.md), [engine run t13b](../../engine-findings.md).

## How to fix

Write the script in JavaScript, or add the engine to the application and declare it in the project profile (`scriptEngines`).

## Example

Reported:

```xml
<!-- process -->
<scriptTask id="s" scriptFormat="groovy"><script>x = 1</script></scriptTask>
```

Accepted:

```xml
<!-- process -->
<scriptTask id="s" scriptFormat="javascript"><script>1</script></scriptTask>
```

[All lint rules](index.md)
