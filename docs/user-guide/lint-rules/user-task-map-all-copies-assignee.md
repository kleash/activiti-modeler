# user-task-map-all-copies-assignee

**MAP_ALL on a user task**

| | |
|---|---|
| Rule | `activiti/user-task-map-all-copies-assignee` |
| Severity | info |
| Kind | Engine behaviour the validator does not catch |
| Reads | the extensions JSON of the process |

## Why it matters

When a task is completed Activiti offers `sys_task_assignee` and every input-mapped task variable to the output mapping, so `MAP_ALL` / `MAP_ALL_OUTPUTS` copies them (and all the input variables) into the process as well. Usually harmless, sometimes surprising.

Evidence: [engine-findings 1](../../engine-findings.md).

## How to fix

List the outputs you need instead of `MAP_ALL`.

## Example

Reported:

```xml
<!-- process -->
<userTask id="u"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "u": {
      "mappingType": "MAP_ALL"
    }
  },
  "constants": {}
}
```

Accepted:

```xml
<!-- process -->
<userTask id="u"/>

<!-- extensions -->
{
  "properties": {},
  "mappings": {
    "u": {
      "mappingType": "MAP_ALL_INPUTS"
    }
  },
  "constants": {}
}
```

[All lint rules](index.md)
