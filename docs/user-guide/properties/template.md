# Template

The element template a task was created from. The group is the "template header" of the panel; the generated templates and the catalog they come from are described in [Connectors and element templates](../connectors.md#element-templates).

**Shown for:** abstract tasks, service tasks and send tasks (mail).

| State | The group shows | Buttons |
|---|---|---|
| Not from a template | "This task was not created from a template" | **Apply template...** opens the chooser |
| From a current template | the template name and version | **Apply another template...**, **Unlink** |
| The connector now has a newer version | a warning with both versions | **Update to version N**, **Unlink** |
| Its connector or action is gone from the project | a warning | **Unlink** |

The task records the link in two attributes: `activiti:templateId` (`<connector>.<ACTION>`, or `builtin/<kind>`) and `activiti:templateVersion`. Lint rule L36 (`connector-template-outdated`) reads the version. A task also stops being linked when its implementation is changed to something else than the template makes.

Everything is one undo step: **Apply** (sets the implementation and name, maps the action's inputs and outputs, declares the output targets), **Update** (adds the inputs and outputs the new version has, keeps your rows) and **Unlink** (removes the two attributes and nothing else).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
