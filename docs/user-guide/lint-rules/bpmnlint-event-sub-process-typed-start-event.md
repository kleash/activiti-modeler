# bpmnlint/event-sub-process-typed-start-event

**An event sub process whose start event has no type**

| | |
|---|---|
| Rule | `event-sub-process-typed-start-event` of [bpmnlint](https://github.com/bpmn-io/bpmnlint) |
| Severity in `activiti:recommended` | error |

## What it means for Activiti

An event sub process is started by its start event, so the start event must be an error or message event in Activiti. A none start event never fires; timer starts are rejected and signal starts do nothing (see `no-signal-start-in-event-subprocess`).

Message note: an event sub process needs an error or message start event (R1 §3.5).

[All lint rules](index.md)
