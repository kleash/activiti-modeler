# bpmn-model-target-namespace-too-long

**The targetNamespace of the definitions is longer than 255 characters**

| | |
|---|---|
| Rule | `activiti/bpmn-model-target-namespace-too-long` |
| Severity | error |
| Engine problem key | `BPMN_MODEL_TARGET_NAMESPACE_TOO_LONG` (mirrors `ProcessValidator`) |
| Kind | Engine validator mirror |

## Why it matters

The target namespace becomes the process definition category, limited to 255 characters.

Evidence: [R1 §7 (ProcessValidator keys)](../../research/activiti-9-bpmn-support.md).

## How to fix

Shorten **Target namespace** on the definitions.

## Example

Reported:

```xml
<!-- process -->

```

Accepted:

```xml
<!-- process -->

```

[All lint rules](index.md)
