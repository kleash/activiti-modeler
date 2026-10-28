# connector-bean-unknown

**A service task calls a connector that is not in the project**

| | |
|---|---|
| Rule | `activiti/connector-bean-unknown` |
| Severity | error |
| Kind | Extra rule L8 (FEATURE_MATRIX §D) |
| Reads | the other files of the project |

## Why it matters

A service task with `implementation="<connector>.<ACTION>"` runs the Spring bean of that name; if there is none, the task fails at run time with `NoSuchBeanDefinitionException` (nothing checks it at deployment). The project's `connectors/` folder is the catalog of the beans the application provides.

Evidence: [R1 §6.1](../../research/activiti-9-bpmn-support.md), [R1 §7.1 L8](../../research/activiti-9-bpmn-support.md).

## How to fix

Add the connector to `connectors/` (Connector catalog editor), or fix the name. A bean without a descriptor can be added there too.

## Example

Reported:

```xml
<!-- process -->
<serviceTask id="s" implementation="mailer.SEND"/>
```

Accepted:

```xml
<!-- process -->
<serviceTask id="s" implementation="crm.LOOKUP"/>
```

[All lint rules](index.md)
