# C06 messages

Hand-written seed: matrix rows **E3** (message start), **E6** (message start in an event sub process, interrupting and not), **E11**
and **E20** (message end and intermediate throw, with a custom throw delegate), **E13** (catch with `messageRef`,
`messageExpression` and `correlationKey`), **E23** (boundary message, interrupting and not), payload mappings, and the same-name
subscription case of lint L30 with what `ProcessRuntime.receive` really does.

| Process (`seed/processes/`) | What it shows | Scenarios |
|---|---|---|
| `messageStart` | Two message start events: the mapped one applies its mapping as an output mapping of the message variables (unmapped ones are dropped), the plain one passes them as they are; an unknown message cannot start anything (engine finding 30) | `message-start` (3) |
| `messageCatch` | A catch by `messageRef` with a correlation key and one by `activiti:messageExpression`; wrong key, no key and wrong name find nothing; the payload passes only through the catch mapping (explicit output, `MAP_ALL_OUTPUTS`) | `message-catch` (2) |
| `messageBoundary` | A user task with an interrupting and a non-interrupting boundary message, both correlated on the order; the non-interrupting one can be received repeatedly; mappings on the boundary events; subscriptions disappear with the task | `message-boundary` (3) |
| `messageEventSubprocess` | An interrupting and a non-interrupting event sub process started by messages with correlation keys; the non-interrupting one fires only once (engine finding 32) | `message-event-subprocess` (3) |
| `messageThrow` | Throw events never send by default; a delegate on the message event definition (`activiti:delegateExpression`, `activiti:class`) receives name, correlation key, business key and the payload of the input mapping; `<activiti:field>` is not injected (engine finding 33); a message end event | `message-throw` |
| `messageEnd` | A message end event whose delegate is a Java class (`activiti:class`) with a correlation key and an input mapping: the delegate receives exactly the mapped payload (a renamed variable, a variable, a fixed value; nothing that is not mapped), the correlation key and the business key; the mapped names do not become process variables | `message-end` |
| `messageSameName` | Two catches of one message name: the key selects the subscription; without a key the query is ambiguous (two) or finds nothing (one); same name with the same key is refused at the second subscription (engine finding 31) | `message-same-name` (2) |
| `messageClash` | A boundary message and an event sub process start with the same name and no key: ambiguous only while the user task waits, because the receive task before it lets the event sub process subscribe alone first (engine finding 31) | `message-clash` (2) |

`model-expect.json` asserts the message event definitions (name, correlation key, expression, field extensions), `cancelActivity`
and `isInterrupting`. `scenarios/coverage-exemptions.json` exempts the three event sub process containers and their start events:
the engine records no historic activity instance for them (engine finding 34); the flows inside them are visited.

Support used: `recordingThrowMessageDelegate`, `RecordingThrowMessageDelegate`, `FieldThrowMessageDelegate`, `IncrementDelegate`
([corpus support](../../docs/corpus-support.md#messages)).
Engine notes: [engine findings](../../docs/engine-findings.md) 30-34.

Run: `scripts/verify-models.sh corpus --project C06`
