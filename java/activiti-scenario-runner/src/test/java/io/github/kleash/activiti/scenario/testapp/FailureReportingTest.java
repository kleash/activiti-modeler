package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import io.github.kleash.activiti.scenario.report.ScenarioReport;
import io.github.kleash.activiti.scenario.report.Status;

/** A failing assertion must say what was expected, what was found and where. */
class FailureReportingTest extends ScenarioRunnerTestBase {

    @Test
    void taskFieldMismatchesAreAllListedWithExpectedAndActualValues() {
        ScenarioReport report = loan("{ \"expectTask\": { \"activity\": \"review\", \"name\": \"Review C-8\", \"priority\": 10, "
                + "\"candidateGroups\": [\"managers\"], \"assignee\": \"alice\", \"formKey\": { \"$regex\": \"^x\" }, \"localVariables\": { \"amount\": 1 } } }", null);

        assertThat(report.status()).isEqualTo(Status.FAILED);
        assertThat(report.failures()).hasSize(1);
        assertThat(report.failures().get(0))
                .contains("step 1 (expectTask review)")
                .contains("task 'review'.name: expected \"Review C-8\" but was \"Review C-7\"")
                .contains("task 'review'.priority: expected 10 but was 80")
                .contains("task 'review'.candidateGroups: expected exactly [managers] but was [reviewers]")
                .contains("task 'review'.assignee: expected \"alice\" but was null")
                .contains("task 'review'.formKey: expected a value matching /^x/ but was \"reviewForm\"")
                .contains("task 'review'.localVariables.amount: expected 1 but was 5000");
    }

    @Test
    void identityLinksOfATaskAreChecked() {
        ScenarioReport ok = loan("{ \"expectTask\": { \"activity\": \"review\", \"identityLinks\": [ { \"type\": \"candidate\", \"group\": \"reviewers\" } ] } }", null);
        assertThat(ok.failures()).isEmpty();

        ScenarioReport failed = loan("{ \"expectTask\": { \"activity\": \"review\", \"identityLinks\": [ { \"type\": \"supervisor\", \"user\": \"dave\" } ] } }", null);
        assertThat(failed.failures()).hasSize(1);
        assertThat(failed.failures().get(0))
                .contains("task 'review'.identityLinks: expected an identity link of type 'supervisor' for user 'dave' but the task has [candidate:group reviewers]");
    }

    @Test
    void aConnectorCallCountOfZeroNeedsNoCall() {
        ScenarioReport ok = loan("{ \"expectConnectorCall\": { \"activity\": \"review\", \"count\": 0 } }", null);
        assertThat(ok.failures()).isEmpty();

        ScenarioReport failed = loan("{ \"expectConnectorCall\": { \"activity\": \"lookup\", \"count\": 0 } }", null);
        assertThat(failed.failures().get(0)).contains("Expected 0 call(s) at activity 'lookup' but 1 were recorded");
    }

    @Test
    void unmappedTaskVariablesFailAnExactLocalVariablesCheck() {
        ScenarioReport report = loan("{ \"expectTask\": { \"activity\": \"review\", \"localVariables\": { } } }", null);
        assertThat(report.failures().get(0)).contains("task 'review'.localVariables: unexpected entry [amount]");
    }

    @Test
    void aMissingTaskListsWhatIsOpen() {
        ScenarioReport report = loan("{ \"claim\": { \"activity\": \"nope\", \"user\": \"alice\" } }", null);
        assertThat(report.failures().get(0))
                .contains("step 1 (claim nope as alice): No open task at activity 'nope'")
                .contains("Open tasks at the activity: []")
                .contains("all open tasks of the scenario: [review(id=");
    }

    @Test
    void stepsAfterTheFailingOneAreSkippedAndShownInTheRendering() {
        ScenarioReport report = loan("{ \"expectActive\": [\"somethingElse\"] }, { \"claim\": { \"activity\": \"review\", \"user\": \"alice\" } }, "
                + "{ \"completeTask\": { \"activity\": \"review\", \"user\": \"alice\" } }", "{ \"state\": \"COMPLETED\" }");

        assertThat(report.steps()).extracting(s -> s.status()).containsExactly(Status.PASSED, Status.FAILED, Status.SKIPPED, Status.SKIPPED);
        assertThat(report.failures()).hasSize(1).first().asString()
                .contains("expected exactly the active activities [somethingElse] but they are [review]");
        assertThat(report.render())
                .contains("Scenario 's' FAILED")
                .contains("[ok]   start: start process 'loan'")
                .contains("[FAIL] step 1: expectActive [somethingElse]")
                .contains("[skip] step 2: claim review as alice")
                .contains("[skip] step 3: completeTask review as alice")
                .contains("Problems:");
    }

    @Test
    void finalExpectationMismatchesAreAllReported() {
        ScenarioReport report = loan("{ \"completeTask\": { \"activity\": \"review\", \"user\": \"alice\", \"variables\": { \"approved\": false } } }",
                "{ \"state\": \"ACTIVE\", \"endEvents\": [\"approvedEnd\"], \"variables\": { \"approved\": true, \"riskLevel\": \"high\", \"missing\": { \"$exists\": true } }, "
                        + "\"absentVariables\": [\"customerName\"], \"path\": { \"contains\": [\"autoApproved\"], \"notContains\": [\"review\"], "
                        + "\"order\": [[\"review\", \"lookup\"]], \"sequenceFlows\": [\"f_decision_approved\"], \"notSequenceFlows\": [\"f_decision_rejected\"] } }");

        assertThat(report.status()).isEqualTo(Status.FAILED);
        assertThat(report.failures())
                .anySatisfy(f -> assertThat(f).startsWith("state: expected ACTIVE but was COMPLETED"))
                .anySatisfy(f -> assertThat(f).contains("endEvents: expected exactly [approvedEnd] but the instance reached [rejectedEnd]"))
                .anySatisfy(f -> assertThat(f).contains("variables.approved: expected true but was false"))
                .anySatisfy(f -> assertThat(f).contains("variables.riskLevel: expected \"high\" but was \"normal\""))
                .anySatisfy(f -> assertThat(f).contains("variables.missing: expected {\"$exists\":true} but the value is missing"))
                .anySatisfy(f -> assertThat(f).contains("absentVariables: variable 'customerName' exists with value \"Customer C-7\""))
                .anySatisfy(f -> assertThat(f).contains("root.path.contains: activity 'autoApproved' was never entered; entered: [start, lookup, risk, review, decision, rejectedEnd]"))
                .anySatisfy(f -> assertThat(f).contains("root.path.notContains: activity 'review' was entered"))
                .anySatisfy(f -> assertThat(f).contains("root.path.order [review, lookup]: expected 'review' to be entered before 'lookup' but the path was"))
                .anySatisfy(f -> assertThat(f).contains("root.path.sequenceFlows: sequence flow 'f_decision_approved' was not taken; taken: ["))
                .anySatisfy(f -> assertThat(f).contains("root.path.notSequenceFlows: sequence flow 'f_decision_rejected' was taken"));
    }

    @Test
    void connectorCallMismatchesNameTheKeyAndTheCall() {
        ScenarioReport report = loan("{ \"expectConnectorCall\": { \"activity\": \"lookup\", \"connector\": \"other.CALL\", \"inbound\": { \"customerId\": \"X\" }, \"outbound\": { \"name\": \"n\", \"risk\": \"normal\" } } }", null);
        assertThat(report.failures().get(0))
                .contains("connector call 1 at 'lookup'.connector: expected \"other.CALL\" but was \"crm.LOOKUP\"")
                .contains("connector call 1 at 'lookup'.inbound.customerId: expected \"X\" but was \"C-7\"")
                .contains("connector call 1 at 'lookup'.inbound: unexpected entry [source]")
                .contains("connector call 1 at 'lookup'.outbound.name: expected \"n\" but was \"Customer C-7\"");
    }

    @Test
    void aSecondConnectorCallThatNeverHappenedIsReported() {
        ScenarioReport report = loan("{ \"expectConnectorCall\": { \"activity\": \"lookup\", \"call\": 2 } }", null);
        assertThat(report.failures().get(0)).contains("Expected at least 2 call(s) of a connector at activity 'lookup' but 1 were recorded");
        ScenarioReport count = loan("{ \"expectConnectorCall\": { \"activity\": \"lookup\", \"count\": 3 } }", null);
        assertThat(count.failures().get(0)).contains("Expected 3 call(s) at activity 'lookup' but 1 were recorded");
    }

    @Test
    void anExpectedFailureThatDoesNotHappenIsAFailure() {
        ScenarioReport report = loan("{ \"completeTask\": { \"activity\": \"review\", \"user\": \"alice\", \"variables\": { \"approved\": true }, \"expectFailure\": { \"messageContains\": \"nope\" } } }", null);
        assertThat(report.failures().get(0)).contains("completeTask 'review' was expected to fail (containing \"nope\") but succeeded");
    }

    @Test
    void aFailureWithTheWrongMessageShowsTheActualOne() {
        ScenarioReport report = loan("{ \"completeTask\": { \"activity\": \"review\", \"user\": \"bob\", \"expectFailure\": { \"messageContains\": \"nope\" } } }", null);
        assertThat(report.failures().get(0))
                .contains("failed, but not as expected: no message contains \"nope\"")
                .contains("Actual failure: NotFoundException: Unable to find task for the given id");
    }

    @Test
    void anUndefinedUserIsNamed() {
        ScenarioReport report = loan("{ \"claim\": { \"activity\": \"review\", \"user\": \"zed\" } }", null);
        assertThat(report.failures().get(0)).contains("User 'zed' is not defined; list it under \"users\" in the scenario file");
    }

    @Test
    void aMissingChildInstanceExplainsWhatToCheck() {
        ScenarioReport report = loan("{ \"expectChildInstance\": { \"callActivity\": \"callKyc\" } }", null);
        assertThat(report.failures().get(0)).contains("Expected call activity 'callKyc' to have started at least 1 child instance(s) but it started 0");
    }

    @Test
    void anUnknownProcessFailsTheStart() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"doesNotExist\", \"user\": \"alice\" }, \"steps\": [ { \"expectActive\": [] } ] }");
        assertThat(report.status()).isEqualTo(Status.FAILED);
        assertThat(report.rootProcessInstanceId()).isNull();
        assertThat(report.steps()).extracting(s -> s.status()).containsExactly(Status.FAILED, Status.SKIPPED);
        assertThat(report.failures().get(0)).startsWith("start (start process 'doesNotExist'): ").contains("Unable to find process definition");
        assertThat(report.cause()).isNotNull();
    }

    @Test
    void aStartThatFailsDifferentlyThanExpectedIsReported() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"doesNotExist\", \"user\": \"alice\", \"expectFailure\": { \"messageContains\": \"required variables\" } } }");
        assertThat(report.failures().get(0)).contains("failed, but not as expected: no message contains \"required variables\"");
    }

    @Test
    void aStartThatSucceedsButShouldFailIsReported() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"loan\", \"user\": \"alice\", \"variables\": { \"customerId\": \"C\", \"amount\": 1 }, \"expectFailure\": {} } }");
        assertThat(report.failures().get(0)).contains("was expected to fail (any failure) but succeeded");
    }

    @Test
    void ambiguousTasksAskForMatchOrCount() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"approvals\", \"user\": \"alice\", \"variables\": { \"people\": [\"bob\", \"carol\"] } },"
                + " \"steps\": [ { \"expectTask\": { \"activity\": \"approveEach\" } }, { \"claim\": { \"activity\": \"approveEach\", \"user\": \"bob\" } } ] }");
        assertThat(report.steps().get(1).message()).contains("2 open tasks at activity 'approveEach'").contains("use \"count\" to check all of them or \"match\" to pick one");
        ScenarioReport claim = run("{ \"name\": \"s\", \"start\": { \"process\": \"approvals\", \"user\": \"alice\", \"variables\": { \"people\": [\"bob\", \"carol\"] } },"
                + " \"steps\": [ { \"claim\": { \"activity\": \"approveEach\", \"user\": \"bob\" } } ] }");
        assertThat(claim.failures().get(0)).contains("narrow it down with \"match\"");
    }

    @Test
    void aTaskMatchThatFindsNothingShowsTheMatchAndTheOpenTasks() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"approvals\", \"user\": \"alice\", \"variables\": { \"people\": [\"bob\", \"carol\"] } },"
                + " \"steps\": [ { \"expectTask\": { \"activity\": \"approveEach\", \"match\": { \"localVariables\": { \"person\": \"zed\" } } } } ] }");
        assertThat(report.failures().get(0)).contains("No open task at activity 'approveEach' matches {localVariables={person=zed}}");
    }

    @Test
    void deadLetterExpectationsShowWhatExists() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"flaky\", \"user\": \"alice\" }, \"steps\": [ { \"failJobUntilDeadLetter\": { \"activity\": \"flakyCall\" } } ],"
                + " \"expect\": { \"state\": \"ACTIVE\", \"deadLetterJobs\": [ { \"activity\": \"flakyCall\", \"exceptionMessageContains\": \"bang\" }, { \"activity\": \"other\" } ] } }");
        assertThat(report.failures())
                .anySatisfy(f -> assertThat(f).contains("state: expected ACTIVE but was DEADLETTER").contains("dead-letter jobs: ["))
                .anySatisfy(f -> assertThat(f).contains("deadLetterJobs: no dead-letter job at activity 'flakyCall' with exception message containing \"bang\""))
                .anySatisfy(f -> assertThat(f).contains("deadLetterJobs: no dead-letter job at activity 'other'"));
    }

    @Test
    void aJobThatSucceedsCannotBeFailedUntilDeadLetter() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"asyncOk\", \"user\": \"alice\" }, \"steps\": [ { \"failJobUntilDeadLetter\": { \"activity\": \"slow\" } } ] }");
        assertThat(report.failures().get(0)).contains("The job at activity 'slow' succeeded on attempt 1 but was expected to keep failing");
    }

    @Test
    void firingATimerThatDoesNotExistListsTheJobs() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"asyncOk\", \"user\": \"alice\" }, \"steps\": [ { \"fireTimer\": { \"activity\": \"nope\" } } ] }");
        assertThat(report.failures().get(0)).contains("No timer job at activity 'nope' in the scenario's instance tree").contains("executable jobs: [");
    }

    @Test
    void triggeringAnActivityNobodyWaitsAtListsTheActiveOnes() {
        ScenarioReport report = loan("{ \"triggerReceiveTask\": { \"activity\": \"waitForPayment\" } }", null);
        assertThat(report.failures().get(0)).contains("No execution is waiting at activity 'waitForPayment'. Active activities: [review]");
    }

    @Test
    void aMultiInstanceReceiveTaskIsTriggeredOneInstanceAtATimeByMatch() {
        String start = "\"start\": { \"process\": \"pickups\", \"user\": \"alice\", \"variables\": { \"parcels\": [\"a\", \"b\"] } }";
        ScenarioReport ambiguous = run("{ \"name\": \"s\", " + start + ", \"steps\": [ { \"triggerReceiveTask\": { \"activity\": \"pickEach\" } } ] }");
        assertThat(ambiguous.failures().get(0)).contains("2 executions are waiting at activity 'pickEach'").contains("narrow it down with \"match\" (localVariables)");

        ScenarioReport none = run("{ \"name\": \"s\", " + start + ", \"steps\": [ { \"triggerReceiveTask\": { \"activity\": \"pickEach\", \"match\": { \"localVariables\": { \"parcel\": \"z\" } } } } ] }");
        assertThat(none.failures().get(0)).contains("None of the 2 executions waiting at activity 'pickEach' matches {localVariables={parcel=z}}");

        ScenarioReport each = run("{ \"name\": \"s\", " + start + ", \"steps\": ["
                + " { \"triggerReceiveTask\": { \"activity\": \"pickEach\", \"match\": { \"localVariables\": { \"parcel\": \"b\" } } } },"
                + " { \"expectActive\": [\"pickEach\"] },"
                + " { \"triggerReceiveTask\": { \"activity\": \"pickEach\", \"match\": { \"localVariables\": { \"parcel\": \"b\" } } } } ] }");
        assertThat(each.steps().get(0).status()).isEqualTo(Status.PASSED);
        assertThat(each.steps().get(1).status()).isEqualTo(Status.PASSED);
        // the instance of b is done; only a still waits
        assertThat(each.failures().get(0)).contains("None of the 1 executions waiting at activity 'pickEach' matches {localVariables={parcel=b}}");

        ScenarioReport both = run("{ \"name\": \"s\", " + start + ", \"steps\": ["
                + " { \"triggerReceiveTask\": { \"activity\": \"pickEach\", \"match\": { \"localVariables\": { \"parcel\": \"b\" } } } },"
                + " { \"triggerReceiveTask\": { \"activity\": \"pickEach\" } } ], \"expect\": { \"state\": \"COMPLETED\", \"endEvents\": [\"pEnd\"] } }");
        assertThat(both.failures()).isEmpty();
    }

    @Test
    void aRunnerBugOrEngineErrorKeepsItsCauseForStackTraces() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"loan\", \"user\": \"alice\", \"variables\": { \"customerId\": \"C\", \"amount\": \"not a number\" } } }");
        assertThat(report.status()).isEqualTo(Status.FAILED);
        assertThat(report.cause()).isNotNull();
        assertThat(report.failures().get(0)).contains("fail type validation");
    }

    @Test
    void executeJobsIsBoundedAndSaysWhatIsStillPending() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"looping\", \"user\": \"alice\", \"variables\": { \"limit\": 100 } },"
                + " \"steps\": [ { \"executeJobs\": { \"maxRounds\": 3 } } ] }");
        assertThat(report.failures().get(0)).contains("executeJobs did not settle after 3 rounds; still executable: [");
    }

    @Test
    void timerExpectationsShowTheDueDatesThatExist() {
        ScenarioReport report = run("{ \"name\": \"s\", \"start\": { \"process\": \"delayed\", \"user\": \"alice\" }, \"steps\": [ { \"expectTimer\": { \"activity\": \"wait\", \"dueDate\": \"2030-01-01T11:00:00Z\" } } ] }");
        assertThat(report.failures().get(0)).contains("timer 'wait'.dueDate: expected \"2030-01-01T11:00:00Z\" but was \"2030-01-01T10:00:00Z\"");
        ScenarioReport count = run("{ \"name\": \"s\", \"start\": { \"process\": \"delayed\", \"user\": \"alice\" }, \"steps\": [ { \"expectTimer\": { \"activity\": \"wait\", \"count\": 2 } } ] }");
        assertThat(count.failures().get(0)).contains("Expected 2 timer job(s) at activity 'wait' but found 1 [");
        ScenarioReport none = run("{ \"name\": \"s\", \"start\": { \"process\": \"delayed\", \"user\": \"alice\" }, \"steps\": [ { \"expectTimer\": { \"activity\": \"nope\" } } ] }");
        assertThat(none.failures().get(0)).contains("No timer job at activity 'nope'; all timer jobs of the scenario: [");
    }
}
