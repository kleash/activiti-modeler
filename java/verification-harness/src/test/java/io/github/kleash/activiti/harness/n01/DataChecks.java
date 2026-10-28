package io.github.kleash.activiti.harness.n01;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import org.activiti.bpmn.model.UserTask;
import org.activiti.engine.delegate.event.ActivitiEvent;
import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.engine.delegate.event.ActivitiEventType;
import org.activiti.engine.impl.cfg.ProcessEngineConfigurationImpl;
import org.activiti.engine.impl.identity.Authentication;
import org.activiti.engine.runtime.Job;
import org.activiti.engine.runtime.ProcessInstance;
import org.activiti.engine.task.IdentityLink;
import org.activiti.engine.task.Task;

import io.github.kleash.activiti.harness.dmn.DmnEvaluationLog;
import io.github.kleash.activiti.scenario.recording.ConnectorCall;
import io.github.kleash.activiti.scenario.recording.ConnectorCallRecorder;

/** Variables, mappings, connectors, decisions and the attributes the engine ignores. */
final class DataChecks {

    private DataChecks() {
    }

    static void register(Map<String, N01Check> checks) {
        N01Checks.put(checks, "auto-store-variables-stores-nothing", DataChecks::autoStoreStoresNothing);
        N01Checks.put(checks, "connector-runs-without-its-required-input", DataChecks::connectorRunsWithoutRequiredInput);
        N01Checks.put(checks, "decision-runs-with-a-missing-input", DataChecks::decisionRunsWithMissingInput);
        N01Checks.put(checks, "unknown-decision-fails", DataChecks::unknownDecisionFails);
        N01Checks.put(checks, "legacy-dmn-column-without-a-name-fails", DataChecks::legacyDmnColumnWithoutNameFails);
        N01Checks.put(checks, "undeclared-output-target-is-dropped", DataChecks::undeclaredOutputTargetIsDropped);
        N01Checks.put(checks, "user-task-without-mapping-loses-its-variables", DataChecks::userTaskWithoutMappingLosesVariables);
        N01Checks.put(checks, "skip-expression-is-ignored-without-the-enable-variable", DataChecks::skipExpressionIgnored);
        N01Checks.put(checks, "failed-job-retry-cycle-ignored-on-a-user-task", DataChecks::retryCycleIgnoredOnUserTask);
        N01Checks.put(checks, "camunda-task-listener-class-is-called", DataChecks::camundaTaskListenerClassIsCalled);
        N01Checks.put(checks, "camunda-task-listener-fires", DataChecks::camundaTaskListenerFires);
        N01Checks.put(checks, "camunda-attributes-are-lost", DataChecks::camundaAttributesAreLost);
    }

    // ---- script task ------------------------------------------------------------------------------------------------------------

    private static void autoStoreStoresNothing(N01Engine e) {
        ProcessInstance instance = e.start("autoStore");

        assertThat(e.ended(instance.getId())).as("the script ran without an error").isTrue();
        assertThat(e.variables(instance.getId())).as("but `total = 1;` did not create a variable").doesNotContainKey("total").isEmpty();
    }

    // ---- connectors ---------------------------------------------------------------------------------------------------------------

    private static void connectorRunsWithoutRequiredInput(N01Engine e) {
        ProcessInstance instance = e.start("connectorInput");

        assertThat(e.ended(instance.getId())).isTrue();
        List<ConnectorCall> calls = e.context.bean(ConnectorCallRecorder.class).callsOf(Set.of(instance.getId()));
        assertThat(calls).as("the connector was called once ...").hasSize(1);
        assertThat(calls.get(0).connector()).isEqualTo("crm.LOOKUP");
        assertThat(calls.get(0).inbound()).as("... without customerId, which its descriptor declares as required").isEmpty();
        assertThat(calls.get(0).error()).isNull();
        assertThat(calls.get(0).outbound()).as("and it answered that it found nobody").containsEntry("found", false);
    }

    private static void undeclaredOutputTargetIsDropped(N01Engine e) {
        ProcessInstance instance = e.start("undeclaredOutput");

        assertThat(e.ended(instance.getId())).isTrue();
        List<ConnectorCall> calls = e.context.bean(ConnectorCallRecorder.class).callsOf(Set.of(instance.getId()));
        assertThat(calls).hasSize(1);
        assertThat(calls.get(0).inbound()).containsEntry("customerId", "C-1");
        assertThat(calls.get(0).outbound()).as("the connector did produce a tier").containsEntry("tier", "standard");
        assertThat(e.variables(instance.getId())).as("but `tier` is not a declared property, so the output mapping dropped it, silently").doesNotContainKey("tier");
    }

    // ---- decisions --------------------------------------------------------------------------------------------------------------

    private static void decisionRunsWithMissingInput(N01Engine e) {
        ProcessInstance instance = e.start("decisionInput", Map.of("age", 30, "region", "EU"));

        assertThat(e.ended(instance.getId())).isTrue();
        List<DmnEvaluationLog.Call> calls = e.context.bean(DmnEvaluationLog.class).calls();
        assertThat(calls).hasSize(1);
        assertThat(calls.get(0).decisionRef()).isEqualTo("grade");
        assertThat(calls.get(0).failure()).isNull();
        assertThat(calls.get(0).inputs()).as("`region` is a process variable but the mapping hands only `age` over: the decision sees null for it")
                .containsOnlyKeys("age").containsEntry("age", 30);
    }

    private static void unknownDecisionFails(N01Engine e) {
        assertThatThrownBy(() -> e.start("decisionUnknown", Map.of("age", 30))).satisfies(t -> assertThat(N01Engine.chain(t)).contains("ActivitiException: Decision task 'decide'", "'nothing' is neither a DMN resource name, a DMN definitions name nor a decision id"));
        assertThat(e.instancesOf("decisionUnknown")).as("rolled back").isEmpty();
    }

    private static void legacyDmnColumnWithoutNameFails(N01Engine e) {
        assertThat(e.repository.getDeploymentResourceNames(e.definition("dmnCaller").getDeploymentId())).as("the DMN 1.1 file is a resource of the deployment")
                .contains("legacy-discount.dmn");
        assertThatThrownBy(() -> e.start("dmnCaller", Map.of("customer", "gold")))
                .satisfies(t -> assertThat(N01Engine.chain(t)).contains("Decision 'discount' in legacy-discount.dmn: output column 'output1' has no name"));
        assertThat(e.instancesOf("dmnCaller")).as("rolled back").isEmpty();
    }

    // ---- user tasks ---------------------------------------------------------------------------------------------------------------

    private static void userTaskWithoutMappingLosesVariables(N01Engine e) {
        ProcessInstance instance = e.start("missingMapping", Map.of("x", 1));
        Task task = e.openTasks(instance.getId()).get(0);
        assertThat(e.tasks.getVariablesLocal(task.getId())).as("the task is created without task-local variables: nothing is copied from the process").isEmpty();

        e.claimAndComplete(task.getId(), "ann", "g", Map.of("y", 2));

        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.variables(instance.getId())).as("the completion variable never reached the process").containsEntry("x", 1).doesNotContainKey("y");
    }

    private static void skipExpressionIgnored(N01Engine e) {
        ProcessInstance instance = e.start("skipExpr", Map.of("skip", true));

        assertThat(e.running(instance.getId())).as("the expression is true but _ACTIVITI_SKIP_EXPRESSION_ENABLED is not set: the task is created").isTrue();
        assertThat(e.waitingAt(instance.getId())).containsExactly("review");
        assertThat(e.openTasks(instance.getId())).hasSize(1);
    }

    // ---- retries -------------------------------------------------------------------------------------------------------------------

    private static void retryCycleIgnoredOnUserTask(N01Engine e) {
        UserTask task = (UserTask) e.element("retryUser", "review");
        assertThat(task.getFailedJobRetryTimeCycleValue()).as("the cycle is parsed into the model").isEqualTo("R5/PT1S");

        AtomicInteger attempts = new AtomicInteger();
        ((ProcessEngineConfigurationImpl) e.configuration).getEventDispatcher().addEventListener(new ActivitiEventListener() {
            @Override
            public void onEvent(ActivitiEvent event) {
                attempts.incrementAndGet();
                throw new IllegalStateException("task creation fails: attempt " + attempts.get());
            }

            @Override
            public boolean isFailOnException() {
                return true;
            }
        }, ActivitiEventType.TASK_CREATED);

        ProcessInstance instance = e.start("retryUser");
        assertThat(e.jobsOf(instance.getId())).as("the async user task waits as a job").hasSize(1);

        e.driver.failJobUntilDeadLetter(e.scope(instance.getId()), "review", 10, 0);

        assertThat(attempts.get()).as("three attempts, the default, not the five of R5").isEqualTo(3);
        List<Job> deadLetters = e.management.createDeadLetterJobQuery().processInstanceId(instance.getId()).list();
        assertThat(deadLetters).hasSize(1);
        assertThat(e.management.getDeadLetterJobExceptionStacktrace(deadLetters.get(0).getId())).as("the last attempt is the one on record").contains("attempt 3");
    }

    // ---- what the engine loses of a Camunda Modeler file -------------------------------------------------------------------------

    /** Variant: the file as the original, with the two service tasks deployable, started as a user who is the initiator. */
    private static void camundaAttributesAreLost(N01Engine e) {
        UserTask review = (UserTask) e.element("approval", "review");
        assertThat(review.getAssignee()).as("camunda:assignee is not read").isNull();
        assertThat(review.getCandidateGroups()).as("camunda:candidateGroups is not read").isEmpty();
        assertThat(review.getDueDate()).isNull();

        Authentication.setAuthenticatedUserId("ann");
        ProcessInstance instance;
        try {
            instance = e.start("approval", Map.of("reviewer", "ann", "dueDate", new Date(), "total", 5, "decision", true));
        } finally {
            Authentication.setAuthenticatedUserId(null);
        }

        Task task = e.openTasks(instance.getId()).get(0);
        assertThat(task.getAssignee()).as("no assignee").isNull();
        assertThat(task.getDueDate()).as("no due date").isNull();
        assertThat(task.getFormKey()).as("no form key").isNull();
        List<IdentityLink> links = e.tasks.getIdentityLinksForTask(task.getId());
        assertThat(links).as("no candidate group").isEmpty();
        assertThat(e.tasks.getVariablesLocal(task.getId())).as("camunda:inputOutput is not a mapping: the task has no local variables").isEmpty();
        assertThat(e.variables(instance.getId())).as("camunda:initiator is not read: the starter is not stored").doesNotContainKey("starter");

        e.tasks.complete(task.getId());

        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.variables(instance.getId())).as("both service tasks ran synchronously: asyncBefore and asyncAfter are not read")
                .containsEntry("archiveRan", true).containsEntry("notifyRan", true)
                .as("camunda:resultVariable is not read").doesNotContainKey("archived")
                .as("camunda:outputParameter is not read").doesNotContainKey("approved");
    }

    private static void camundaTaskListenerClassIsCalled(N01Engine e) {
        assertThat(((UserTask) e.element("approval", "review")).getTaskListeners()).as("the camunda: element is a task listener of the model").hasSize(1);

        assertThatThrownBy(() -> e.start("approval", Map.of("reviewer", "ann", "total", 5)))
                .satisfies(t -> assertThat(N01Engine.chain(t)).contains("com.example.ReviewCreated"));
        assertThat(e.instancesOf("approval")).as("rolled back").isEmpty();
    }

    private static void camundaTaskListenerFires(N01Engine e) {
        ProcessInstance instance = e.start("approval", Map.of("reviewer", "ann", "total", 5));

        assertThat(e.openTasks(instance.getId())).hasSize(1);
        assertThat(e.variables(instance.getId())).as("the listener of the camunda namespace fired").containsEntry("taskListenerCalls", List.of("create:review"));
    }
}
