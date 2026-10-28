# Decision

The DMN decision a decision task evaluates, and how the task is wired to what the decision reads and returns. A decision task is a service task with `implementation="dmn-connector.EXECUTE_TABLE"` ([ADR 0004](../../adr/0004-dmn-execution.md)); the decision id is the constant `_activiti_dmn_table_` in the extensions file.

**Shown for:** decision tasks (Implementation type **Decision (DMN)**, or the **Decision task** in the palette).

| Field | Entry id | Written to the model |
|---|---|---|
| DMN file | `decision.pick.file` | nothing (it only filters the decisions) |
| Decision | `decision.pick` | constant `_activiti_dmn_table_` = the decision id, **and** the mapping rows below |
| Decision id | `decision.table` | constant `_activiti_dmn_table_` only (free text, also a DMN file name that holds one decision) |
| Actions | `decision.pick.actions` | the buttons below |

The pickers list the `*.dmn` files of the project and their decisions (read from the working copies, so an unsaved DMN is seen). Without a DMN file only the decision id field is shown.

## Choosing a decision wires the task

Choosing a decision writes the decision id and then, in the same undo step:

- **inputs:** a `VARIABLE` input for every input the decision reads (the table's input names, those of the decisions it requires, and its required input data); rows the task already has are kept;
- **outputs:** a `VARIABLE` output for every output column (`name` = `name`), or, for a decision that returns a list (COLLECT without an aggregator, RULE ORDER, OUTPUT ORDER), one output for the list under the decision id;
- **declared variables** for every target, typed from the FEEL type of the column (`string`, `boolean`, `date`, `datetime`; numbers become `bigdecimal`, as FEEL numbers are BigDecimals; the list is an `array`).

The buttons repeat the parts alone: **Map the inputs**, **Map the outputs**, **Store "a rule matched"** (an output for `_activiti_dmn_matched_`, a boolean, into `decisionMatched`) and **Store the matched rules** (`_activiti_dmn_matched_rules_`, the ids of the rules that contributed, in result order, into `decisionMatchedRules`). Rename the targets in the mapping rows afterwards.

## Engine notes (shown in the group)

- The connector gets only the mapped inputs. A **missing input is `null` in FEEL**, so a mapping that is missing or misspelled shows up as "no rule matched", not as an error; the group lists the inputs the task leaves unmapped (lint rule L37).
- Outputs: one variable per output column (a column needs a `name`, lint L33), or the list of rows under the decision id; always `_activiti_dmn_matched_` and `_activiti_dmn_matched_rules_`. **With no match the output columns are not emitted**, and the engine's `VARIABLE` output skips null, so a mapped variable keeps its previous value; map `_activiti_dmn_matched_` to react to "no match" (COLLECT COUNT is the exception: it emits `0`).
- All of it reaches the process only through the output mapping ([ADR 0003](../../adr/0003-model-file-contract.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
