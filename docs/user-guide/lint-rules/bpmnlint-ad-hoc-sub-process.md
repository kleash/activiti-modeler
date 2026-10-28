# bpmnlint/ad-hoc-sub-process

**A start or end event inside an ad-hoc sub process**

| | |
|---|---|
| Rule | `ad-hoc-sub-process` of [bpmnlint](https://github.com/bpmn-io/bpmnlint) |
| Severity in `activiti:recommended` | error |

## What it means for Activiti

BPMN allows neither a start nor an end event inside an ad-hoc sub process. The sub process itself is reported by `no-ad-hoc-sub-process`, because Activiti waits in it forever (R1 §0.1-5).

Message note: BPMN allows no start or end event in an ad-hoc sub process; the sub process hangs in Activiti 9 (R1 §0.1-5).

[All lint rules](index.md)
