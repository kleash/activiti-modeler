# duplicate-element-id

**Two elements have the same id**

| | |
|---|---|
| Rule | `activiti/duplicate-element-id` |
| Severity | error |
| Kind | Engine behaviour the validator does not catch |

## Why it matters

bpmn-moddle keeps the first element of an id and drops the later ones when it reads the file, so saving the file would lose them silently. Ids must be unique and are NCNames.

Evidence: [ADR 0003 guarantee 4](../../adr/), verify.ts DUPLICATE_ID.

## How to fix

Give the second element its own id in the XML view (the dropped element is not in the diagram any more; reopen the original file to see it).

## Example

Reported:

```xml
<!-- process -->
<task id="t"/><task id="t"/>
```

Accepted:

```xml
<!-- process -->
<task id="t"/><task id="u"/>
```

[All lint rules](index.md)
