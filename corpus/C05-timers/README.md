# C05 timers

Hand-written seed: matrix rows **E2** (timer start: date, cycle with `activiti:endDate`, cron, business calendar), **E12**
(intermediate catch timer) and **E21** (boundary timer, interrupting and non-interrupting, repeating), all under a fixed clock
(`2030-01-01T09:00:00Z`) and driven either by `fireTimer` (the job is made due whatever the clock says) or by `advanceClock` +
`executeJobs` (only due timers fire).

| Process (`seed/processes/`) | What it shows | Scenarios |
|---|---|---|
| `timerStarts` | Four timer start events in one process: a fixed date, `R3/PT1H` with a future end date, a cron expression with `activiti:businessCalendarName="cycle"`, and a repeat whose end date has passed. `start.timer` fires the start job of one of them; the expired one is dropped when it fires (engine finding 26) | `timer-starts` (4) |
| `intermediateTimers` | A duration (calendar `duration`), a fixed date and a cycle in a row; due dates under the fixed clock; the cycle fires only once at an intermediate event | `intermediate-timers` (2) |
| `interruptingTimers` | Three user tasks, each with an interrupting boundary timer of another kind (duration, date, cycle); the timer cancels the task; completing the task removes the timer; an interrupting cycle does not repeat | `interrupting-timers` (4) |
| `repeatingTimer` | A non-interrupting `R3/PT1H` boundary: three firings at hourly due dates, the task stays open, no timer is left afterwards | `repeating-timer` (3) |
| `endDateTimer` | A non-interrupting `R/PT1H` boundary with `activiti:endDate="2030-01-01T11:30:00Z"`: reminders at 10:00 and 11:00, none at 12:00; a late executor skips what it missed (engine finding 27) | `end-date-timer` (2) |
| `cronTimer` | A non-interrupting cron boundary (`0 0/30 * * * ?`); the due date is asserted as a 30 minute window because cron runs in the JVM time zone | `cron-timer` (2) |

`model-expect.json` asserts the timer definitions (`timeDate`, `timeDuration`, `timeCycle`, `endDate`, `calendarName`) and
`cancelActivity` of every timer event. `scenarios/coverage-exemptions.json` exempts the expired start event and its flow: the
engine drops its job, which is what the fourth `timer-starts` scenario asserts.

Support used: `IncrementDelegate` ([corpus support](../../docs/corpus-support.md)). The harness runs without the async executor,
so the validator warning `EVENT_TIMER_ASYNC_NOT_AVAILABLE` is expected and filtered.
Engine notes: [engine findings](../../docs/engine-findings.md) 14, 26, 27.

Run: `scripts/verify-models.sh corpus --project C05`
