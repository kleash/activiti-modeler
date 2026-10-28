# C03 script-tasks

Hand-written seed (the oracle for the modeler-generated version of the same project): matrix row **T9** - script tasks in JUEL and
JavaScript, result variables, scripts that read and write variables, `activiti:autoStoreVariables`, and a `BpmnError` thrown from a
script.

| Process (`seed/processes/`) | What it shows | Scenarios |
|---|---|---|
| `juelScripts` | The default script language (no `scriptFormat`) and `scriptFormat="juel"`: the script is an expression and its value goes to `activiti:resultVariable`; process variables, Spring beans (`greeter`, `scriptHelper`) and `execution` are visible by name; `${execution.setVariable(...)}` writes a variable; a gateway routes on the written flag, including the exact threshold | `juel-scripts` (3) |
| `javascriptScripts` | JavaScript (Nashorn) under the three names `javascript`, `js` and `ECMAScript`: variables by name, `execution.setVariable`, the value of the last expression as result, a list variable, numbers | `javascript-scripts` (3) |
| `autoStore` | `activiti:autoStoreVariables` on and off: JavaScript assignments are not stored either way (engine finding 25) | `auto-store` |
| `scriptErrors` | A `BpmnError` thrown by a JavaScript or a JUEL script is routed to the error boundary events of the script task (by error code, and catch-all); an unhandled code and an ordinary exception fail the call | `script-errors` (5) |

`model-expect.json` asserts `scriptFormat`, `resultVariable`, `autoStoreVariables` and the script text, and that an error boundary
event is parsed with `cancelActivity=false` (the converter forces it, R1 3.2). Every flow node and sequence flow is visited (no
exemptions).

Support used: the beans `greeter` and `scriptHelper` ([corpus support](../../docs/corpus-support.md#scripts)).
Engine notes: [engine findings](../../docs/engine-findings.md) 25, 36.

Run: `scripts/verify-models.sh corpus --project C03`
