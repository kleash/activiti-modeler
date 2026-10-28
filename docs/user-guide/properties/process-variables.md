# Process variables

The variables a process declares: a name, a type, and an optional default. They are written to `properties` of the process in the `-extensions.json` file next to the BPMN file.

**Shown for:** the process (and a pool, which stands for its process).

| Field | Entry id | Written to the model |
|---|---|---|
| Name | `variables.list[i].name` | `properties.<id>.name` (a plain identifier: letters, digits, `_`, `$`; unique) |
| Type | `variables.list[i].type` | `type`: `boolean`, `string`, `integer`, `bigdecimal`, `json`, `file`, `folder`, `content`, `date`, `datetime`, `array` |
| Required | `variables.list[i].required` | `required`: a start without the variable is rejected |
| Default value | `variables.list[i].value` | `value`, typed from the text (see below) |
| Description | `variables.list[i].description` | `description` |
| Display name, Display, Analytics, Ephemeral | `variables.list[i].displayName`, `.display`, `.analytics`, `.ephemeral` | `displayName`, `display`, `analytics`, `ephemeral` (behind **More fields**) |

Variables keep their order. Renaming a variable keeps its id. Every field is one change in the file and one undo step.

## Default values are checked against the type

| Type | The default is | Stored as |
|---|---|---|
| `string` | any text | text |
| `boolean` | `true` or `false` | a boolean |
| `integer` | a whole number | a number |
| `bigdecimal` | a number (`12.50` keeps its exact text) | a number, or text when a number would reformat it |
| `date`, `datetime` | ISO 8601: `2030-05-17`, `2030-05-17T10:15:30Z` | text |
| `json`, `file`, `folder`, `content` | JSON | the JSON value |
| `array` | a JSON list | a list |

A default that is `${...}` is an expression, resolved against the start variables when an instance starts, and is accepted for every type. A default that does not fit the type is refused with a message under the field; the variable keeps its last valid version in the file until the value is fixed.

## Removing a variable

Output mappings write **only declared variables**: the engine silently drops an output whose target is not declared ([finding 16](../../engine-findings.md)). The modeler therefore declares the target of every output mapping (typed from the connector action or the decision when it knows the type). When you remove a variable that an output mapping targets, the panel says which element it is the target of and asks for confirmation (**Delete anyway** or **Keep**). A variable that an input mapping only reads gets a lighter note.

## Engine notes

- A start payload is validated against the types strictly: an `integer` takes a Java `Integer` only, text is never converted, `array` accepts an object and `json` accepts text ([finding C15.1](../../engine-findings.md)). A missing required variable fails the start with `Can't start process '<key>' without required variables - <names>`.
- A `json` (or other JSON-valued) property **without a default** creates a variable holding JSON null at start ([finding 4](../../engine-findings.md)); a `MAP_ALL` mapping then passes the null on. The panel flags such a variable; give it a default.
- Defaults are applied in two passes: plain defaults first, then the ones that contain an expression, which see the other defaults and the overridden values ([finding C15.3](../../engine-findings.md)).
- `display`, `displayName`, `analytics`, `ephemeral` and `description` are read and kept by the runtime, but nothing in Activiti 9.0.0 acts on them. The runtime's variable model has **no category**, so the modeler cannot store one (the exporter writes only fields the model classes know, [ADR 0003](../../adr/0003-model-file-contract.md); [finding C15.4](../../engine-findings.md)).
- A process variable whose name starts with an underscore cannot be a start variable (`ProcessRuntime` refuses it); declare it here with a default instead, as for `_ACTIVITI_SKIP_EXPRESSION_ENABLED` ([finding 6](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
