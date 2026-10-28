# Mail and shell fields

The fields of mail tasks and shell tasks, as fields of the task (`<activiti:field>`).

**Shown for:** service and send tasks of type mail (`mail.*`), and service tasks of type shell (`shell.*`).

| Field | Entry id | Written to the model |
|---|---|---|
| Mail | `mail.to`, `mail.from`, `mail.cc`, `mail.bcc`, `mail.subject`, `mail.text`, `mail.textVar`, `mail.html`, `mail.htmlVar`, `mail.charset`, `mail.ignoreException`, `mail.exceptionVariableName`, `mail.attachments` | one field each |
| Shell | `shell.command`, `shell.arg1` to `shell.arg5`, `shell.directory`, `shell.wait`, `shell.redirectError`, `shell.cleanEnv`, `shell.outputVariable`, `shell.errorCodeVariable` | one field each |

## Engine notes

- Mail needs a `from` field or a default sender configured on the engine (`mailServerDefaultFrom`); with neither, sending fails ([C14.1](../../engine-findings.md)).
- `textVar` and `htmlVar` name a variable whose content is evaluated as an expression at send time, so the field value is the variable *name* ([C14.2](../../engine-findings.md)).
- `ignoreException=true` swallows every failure of the task and stores the message in `exceptionVariableName` ([C14.3](../../engine-findings.md)).
- A shell task never fails on a non-zero exit code; read it from the exit code variable. With `wait=false` neither output variable is written; `redirectError=true` merges standard error into the output ([C14.4](../../engine-findings.md)).

Back to the [properties overview](../modeler-basics.md#the-properties-panel).
