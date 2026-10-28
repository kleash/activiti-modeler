# C15 data-properties

Hand-written seed for process data: process properties of every type with defaults, required-property rejection and type
validation (the `-extensions.json` `properties`), data objects of every `xsd` type (D1), and the properties of the none start
event (E1: initiator, form key, legacy form properties, and the start mapping).

| Process (`seed/processes/`) | What it shows |
|---|---|
| `propertyTypes` + `property-types-extensions.json` | Properties `string`, `integer`, `boolean`, `bigdecimal` (from text and from a number), `json`, `file`, `folder`, `content`, `array`, `date`, `datetime`, a `required` one, an expression default (`${orderId}-${count}`), a property without default, and the metadata fields. Scenarios: defaults only, overrides, typed rejection of every type, a missing required property, expressions in the payload, and what the runtime's reader kept of the metadata (`extensionInspector`) |
| `dataObjects` | Data objects `xsd:string`, `xsd:int`, `xsd:long`, `xsd:double`, `xsd:boolean`, `xsd:datetime`, one without a type, one without a value, one a start variable overrides, and one local to an embedded sub process |
| `startEventProperties` + extensions | `activiti:initiator`, `activiti:formKey`, legacy `activiti:formProperty` (parsed, never enforced) and the extensions mapping of the start event: it works as an output mapping on the start payload, so only the mapped variables reach the process |

Support code: `${extensionInspector}` (`docs/corpus-support.md`, section C15), plus `${greeter}`. Engine behaviour asserted here is
in `docs/engine-findings.md`, section "C15 data and properties".

`model-expect.json` asserts the parsed data objects (name, xsd type, typed value), the sub process data object, the process
documentation, `initiator`, `formKey` and the form properties with their enum values. Every flow node and sequence flow is visited
(no exemptions).

Run: `scripts/verify-models.sh corpus --project C15`
