# C14 mail-shell

Hand-written seed for the mail task (T7), the send task (T10) and the shell task (T8). The mail tasks run against a GreenMail
SMTP server the harness starts for this project; the shell tasks run real commands (`echo`, `sh`, `pwd`, `/usr/bin/env`; Linux and
macOS).

| Process (`seed/processes/`) | What it shows |
|---|---|
| `mailTasks` | `activiti:type="mail"` with `to`, `from`, `cc`, `bcc`, `subject`, `text`, `html` (with a plain alternative), `charset`, `textVar` / `htmlVar` (the field names a variable whose content is evaluated at send time), `attachments` (a data source), the default `from` address of the engine, and a `sendTask` with `activiti:type="mail"`. The capture tasks copy the delivered inboxes into variables |
| `mailErrors` | `ignoreException` and `exceptionVariableName`: an invalid recipient is swallowed (message in the variable) or fails the call |
| `shellTasks` | `command`, `arg1` to `arg5`, `outputVariable` (stdout), `errorCodeVariable` (exit code as text, a non-zero code does not fail the task), `redirectError`, `directory`, `cleanEnv` and `wait=false` (no output and no exit code variables) |

## How the mail server gets into the context

`harness.properties` next to the seed (`corpus/C14-mail-shell/harness.properties`) contains `harness.greenmail=true`. The harness
passes the entries of that file to the project's Spring context, and `MailSupportConfiguration` (a conditional configuration in the
support package) then starts GreenMail on a free local port and points the engine's `mailServerHost`, `mailServerPort` and
`mailServerDefaultFrom` (`noreply@corpus.test`) at it. Every project context has its own server. The `mailbox` bean reads what
was delivered. Details in `docs/corpus-support.md`, section C14; the same file works for any folder passed to the harness.

`model-expect.json` asserts the parsed `type` (`mail`, `shell`) and field lists of the mail, send and shell tasks. Every flow node
and sequence flow is visited (no exemptions).

Run: `scripts/verify-models.sh corpus --project C14`
