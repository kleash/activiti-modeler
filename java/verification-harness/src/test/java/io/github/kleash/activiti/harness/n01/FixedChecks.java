package io.github.kleash.activiti.harness.n01;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Date;
import java.util.List;
import java.util.Map;

import org.activiti.api.task.model.builders.TaskPayloadBuilder;
import org.activiti.api.task.runtime.TaskRuntime;
import org.activiti.bpmn.model.ExclusiveGateway;
import org.activiti.bpmn.model.StartEvent;
import org.activiti.bpmn.model.ThrowEvent;
import org.activiti.engine.impl.identity.Authentication;
import org.activiti.engine.runtime.ProcessInstance;
import org.activiti.engine.task.IdentityLink;
import org.activiti.engine.task.Task;

import io.github.kleash.activiti.harness.dmn.DmnEvaluationLog;

/**
 * The models the modeler's quick fixes lead to ({@code corpus/N01-negative/engine/fixed}, written by hand) deploy and run as
 * intended: what the degraded model lost, the fixed one does.
 */
final class FixedChecks {

    private FixedChecks() {
    }

    static void register(Map<String, N01Check> checks) {
        N01Checks.put(checks, "fixed-decision-task-grades", FixedChecks::decisionTaskGrades);
        N01Checks.put(checks, "fixed-exclusive-gateway-routes", FixedChecks::exclusiveGatewayRoutes);
        N01Checks.put(checks, "fixed-signal-throw-wakes-the-waiter", FixedChecks::signalThrowWakesTheWaiter);
        N01Checks.put(checks, "fixed-user-task-mapping-passes-variables", FixedChecks::userTaskMappingPassesVariables);
        N01Checks.put(checks, "fixed-declared-output-target-arrives", FixedChecks::declaredOutputTargetArrives);
        N01Checks.put(checks, "fixed-camunda-translation-keeps-what-was-lost", FixedChecks::camundaTranslationKeepsWhatWasLost);
    }

    private static void decisionTaskGrades(N01Engine e) {
        ProcessInstance instance = e.start("businessRuleTask", Map.of("age", 20, "region", "EU"));

        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.context.bean(DmnEvaluationLog.class).calls()).as("the decision was evaluated by the DMN connector").hasSize(1);
        assertThat(e.variables(instance.getId())).as("MAP_ALL takes the result back").containsEntry("grade", "adult");
    }

    private static void exclusiveGatewayRoutes(N01Engine e) {
        assertThat(e.element("complexGateway", "route")).isInstanceOf(ExclusiveGateway.class);

        ProcessInstance small = e.start("complexGateway", Map.of("amount", 50));
        assertThat(e.visited(small.getId())).contains("small", "endSmall").doesNotContain("large", "endLarge");
        ProcessInstance large = e.start("complexGateway", Map.of("amount", 500));
        assertThat(e.visited(large.getId())).contains("large", "endLarge").doesNotContain("small", "endSmall");
    }

    private static void signalThrowWakesTheWaiter(N01Engine e) {
        assertThat(e.element("signalEnd", "raise")).isInstanceOf(ThrowEvent.class);
        ProcessInstance waiter = e.start("signalWaiter");
        assertThat(e.waitingAt(waiter.getId())).containsExactly("wait");

        ProcessInstance thrower = e.start("signalEnd");

        assertThat(e.ended(thrower.getId())).isTrue();
        assertThat(e.visited(thrower.getId())).contains("raise", "raised");
        assertThat(e.ended(waiter.getId())).as("the signal was thrown: the waiting instance moved on").isTrue();
    }

    private static void userTaskMappingPassesVariables(N01Engine e) {
        ProcessInstance instance = e.start("missingMapping", Map.of("x", 1));
        Task task = e.openTasks(instance.getId()).get(0);
        assertThat(e.tasks.getVariablesLocal(task.getId())).as("the task sees the process variables").containsEntry("x", 1);

        e.claimAndComplete(task.getId(), "ann", "g", Map.of("y", 2));

        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.variables(instance.getId())).as("and the completion variable reaches the process").containsEntry("x", 1).containsEntry("y", 2);
    }

    private static void declaredOutputTargetArrives(N01Engine e) {
        ProcessInstance instance = e.start("undeclaredOutput");

        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.variables(instance.getId())).as("the declared target receives the tier").containsEntry("tier", "standard");
    }

    /** What the Camunda file lost (see the variant of camunda-modeler.bpmn20.xml) the translated file has. */
    private static void camundaTranslationKeepsWhatWasLost(N01Engine e) {
        assertThat(((StartEvent) e.element("approval", "start")).getFormKey()).isEqualTo("request-form");

        Date due = new Date(System.currentTimeMillis() + 86_400_000L);
        Authentication.setAuthenticatedUserId("ann");
        ProcessInstance instance;
        try {
            instance = e.start("approval", Map.of("reviewer", "ann", "dueDate", due, "total", 5, "decision", true));
        } finally {
            Authentication.setAuthenticatedUserId(null);
        }

        Task task = e.openTasks(instance.getId()).get(0);
        assertThat(task.getAssignee()).as("the assignee").isEqualTo("ann");
        assertThat(task.getDueDate()).as("the due date").isEqualTo(due);
        assertThat(e.tasks.getIdentityLinksForTask(task.getId())).as("the candidate group")
                .anyMatch((IdentityLink l) -> "candidate".equals(l.getType()) && "managers".equals(l.getGroupId()));
        assertThat(e.tasks.getVariablesLocal(task.getId())).as("camunda:inputOutput, now a mapping").containsEntry("amount", 5);
        assertThat(e.variables(instance.getId())).as("the initiator").containsEntry("starter", "ann")
                .as("the task listener fired").containsEntry("taskListenerCalls", List.of("create:review"));

        TaskRuntime taskRuntime = e.context.bean(TaskRuntime.class);
        e.runAsUser("ann", List.of("managers"), () ->
                taskRuntime.complete(TaskPayloadBuilder.complete().withTaskId(task.getId()).withVariables(Map.of("decision", true)).build()));
        assertThat(e.running(instance.getId())).as("the async service task waits as a job").isTrue();
        assertThat(e.jobsOf(instance.getId())).hasSize(1);

        e.drive(instance.getId());

        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.variables(instance.getId())).as("the output mapping").containsEntry("approved", true)
                .as("the result variable").containsEntry("archived", 2L)
                .as("the delegate bean").containsEntry("lastDelegate", "notify");
    }
}
