# process-key-not-unique-in-project

**Two files of the project define a process with the same key**

| | |
|---|---|
| Rule | `activiti/process-key-not-unique-in-project` |
| Severity | error |
| Kind | Extra rule L34 (FEATURE_MATRIX §D) |
| Reads | the other files of the project |

## Why it matters

The process id is the definition key. Two files with one key deployed together produce two versions of one definition; the later file silently replaces the earlier one.

Evidence: [FEATURE_MATRIX §D L34](../../FEATURE_MATRIX.md), [R1 §3.1](../../research/activiti-9-bpmn-support.md).

## How to fix

Rename one of the processes.

## Example

Reported:

```xml
<!-- processes/other.bpmn20.xml -->
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><process id="p" isExecutable="true"/></definitions>
```

Accepted:

```xml
<!-- processes/other.bpmn20.xml -->
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="x"><process id="q" isExecutable="true"/></definitions>
```

[All lint rules](index.md)
