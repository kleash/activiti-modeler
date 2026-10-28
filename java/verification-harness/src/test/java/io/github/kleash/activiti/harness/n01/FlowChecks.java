package io.github.kleash.activiti.harness.n01;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.activiti.bpmn.model.EndEvent;
import org.activiti.bpmn.model.ExclusiveGateway;
import org.activiti.bpmn.model.FlowElement;
import org.activiti.bpmn.model.Process;
import org.activiti.bpmn.model.SequenceFlow;
import org.activiti.bpmn.model.ServiceTask;
import org.activiti.bpmn.model.StartEvent;
import org.activiti.bpmn.model.ThrowEvent;
import org.activiti.engine.impl.bpmn.behavior.IntermediateThrowNoneEventActivityBehavior;
import org.activiti.engine.impl.bpmn.behavior.NoneEndEventActivityBehavior;
import org.activiti.engine.runtime.ProcessInstance;
import org.activiti.validation.ValidationError;

/**
 * Constructs the engine hangs on, drops or replaces: ad hoc sub process, complex gateway, standard loop, minified multi instance,
 * the event definitions the converter does not read, the service task of type {@code dmn}, groups and data object references.
 */
final class FlowChecks {

    private FlowChecks() {
    }

    static void register(Map<String, N01Check> checks) {
        N01Checks.put(checks, "adhoc-waits-forever", FlowChecks::adHocWaitsForever);
        N01Checks.put(checks, "complex-gateway-is-exclusive", FlowChecks::complexGatewayIsExclusive);
        N01Checks.put(checks, "standard-loop-runs-once", FlowChecks::standardLoopRunsOnce);
        N01Checks.put(checks, "minified-multi-instance-swallows-the-flows", FlowChecks::minifiedSwallowsTheFlows);
        N01Checks.put(checks, "pretty-printed-multi-instance-runs", FlowChecks::prettyPrintedRuns);
        N01Checks.put(checks, "dmn-service-task-is-skipped", FlowChecks::dmnServiceTaskIsSkipped);
        N01Checks.put(checks, "conditional-start-is-none-start", FlowChecks::conditionalStartIsNone);
        N01Checks.put(checks, "escalation-end-is-none-end", FlowChecks::escalationEndIsNone);
        N01Checks.put(checks, "escalation-throw-passes-through", FlowChecks::escalationThrowPassesThrough);
        N01Checks.put(checks, "compensation-end-is-none-end", FlowChecks::compensationEndIsNone);
        N01Checks.put(checks, "group-is-dropped", FlowChecks::groupIsDropped);
        N01Checks.put(checks, "data-object-reference-warns", FlowChecks::dataObjectReferenceWarns);
        N01Checks.put(checks, "orphan-extension-keys-are-inert", FlowChecks::orphanKeysAreInert);
    }

    // ---- ad hoc sub process: hangs --------------------------------------------------------------------------------------------

    private static void adHocWaitsForever(N01Engine e) {
        ProcessInstance instance = e.start("adHocSubProcess");
        e.drive(instance.getId());

        assertThat(e.running(instance.getId())).as("the instance is still running").isTrue();
        assertThat(e.waitingAt(instance.getId())).as("it waits in the ad hoc sub process").containsExactly("ahp");
        assertThat(e.visited(instance.getId())).as("nothing activates the inner tasks, nothing leaves").doesNotContain("a", "b", "end");
        assertThat(e.openTasks(instance.getId())).as("no task to work on").isEmpty();
        assertThat(e.jobsOf(instance.getId())).as("no job or timer that could move it").isEmpty();
        assertThat(e.subscriptionsOf(instance.getId())).as("no event it could wait for").isEmpty();
    }

    // ---- complex gateway: exclusive -------------------------------------------------------------------------------------------

    private static void complexGatewayIsExclusive(N01Engine e) {
        assertThat(e.element("complexGateway", "route")).as("ComplexGatewayXMLConverter builds an exclusive gateway").isInstanceOf(ExclusiveGateway.class);

        ProcessInstance small = e.start("complexGateway", Map.of("amount", 50));
        assertThat(e.ended(small.getId())).isTrue();
        assertThat(e.visited(small.getId())).contains("small", "endSmall").doesNotContain("large", "endLarge");

        ProcessInstance large = e.start("complexGateway", Map.of("amount", 500));
        assertThat(e.ended(large.getId())).isTrue();
        assertThat(e.visited(large.getId())).contains("large", "endLarge").doesNotContain("small", "endSmall");
    }

    // ---- loops ----------------------------------------------------------------------------------------------------------------

    private static void standardLoopRunsOnce(N01Engine e) {
        FlowElement task = e.element("standardLoop", "repeat");
        assertThat(((org.activiti.bpmn.model.Activity) task).getLoopCharacteristics()).as("the converter does not read standardLoopCharacteristics").isNull();

        ProcessInstance instance = e.start("standardLoop");
        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.history.createHistoricActivityInstanceQuery().processInstanceId(instance.getId()).activityId("repeat").count())
                .as("the task ran once").isEqualTo(1);
    }

    private static void minifiedSwallowsTheFlows(N01Engine e) {
        Process process = e.process("minifiedMi");
        assertThat(process.findFlowElementsOfType(SequenceFlow.class)).as("every sequence flow was absorbed into the task").isEmpty();

        ProcessInstance instance = e.start("minifiedMi");
        assertThat(e.ended(instance.getId())).as("the instance ends at its start, without an error").isTrue();
        assertThat(e.visited(instance.getId())).as("the end event is never reached").doesNotContain("end");
    }

    private static void prettyPrintedRuns(N01Engine e) {
        assertThat(e.process("minifiedMi").findFlowElementsOfType(SequenceFlow.class)).extracting(FlowElement::getId)
                .containsExactlyInAnyOrder("f_start_review", "f_review_end");

        ProcessInstance instance = e.start("minifiedMi");
        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.visited(instance.getId())).contains("start", "review", "end");
        assertThat(e.history.createHistoricActivityInstanceQuery().processInstanceId(instance.getId()).activityId("review").count())
                .as("three parallel instances of the task").isEqualTo(3);
    }

    // ---- service task of type dmn ---------------------------------------------------------------------------------------------

    private static void dmnServiceTaskIsSkipped(N01Engine e) {
        ServiceTask task = (ServiceTask) e.element("typeDmn", "decide");
        assertThat(task.getType()).isEqualTo("dmn");
        assertThat(task.getBehavior()).as("no behaviour is attached: ContinueProcessOperation just takes the outgoing flows").isNull();

        ProcessInstance instance = e.start("typeDmn");
        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.variables(instance.getId())).as("no decision was evaluated, no result").isEmpty();
    }

    // ---- event definitions the converter does not read ------------------------------------------------------------------------

    private static void conditionalStartIsNone(N01Engine e) {
        StartEvent start = (StartEvent) e.element("conditionalStart", "start");
        assertThat(start.getEventDefinitions()).as("the conditional definition is dropped").isEmpty();

        ProcessInstance instance = e.start("conditionalStart");
        assertThat(e.ended(instance.getId())).as("a none start event: it starts without any condition").isTrue();
        assertThat(e.visited(instance.getId())).contains("start", "work", "end");
    }

    private static void escalationEndIsNone(N01Engine e) {
        EndEvent end = (EndEvent) e.element("escalationEnd", "esc");
        assertThat(end.getEventDefinitions()).as("the escalation definition is dropped").isEmpty();
        assertThat(end.getBehavior()).isInstanceOf(NoneEndEventActivityBehavior.class);

        ProcessInstance instance = e.start("escalationEnd");
        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.visited(instance.getId())).contains("work", "esc");
    }

    private static void escalationThrowPassesThrough(N01Engine e) {
        ThrowEvent event = (ThrowEvent) e.element("escalationThrow", "escalate");
        assertThat(event.getEventDefinitions()).as("the escalation definition is dropped").isEmpty();
        assertThat(event.getBehavior()).as("a plain none throw event").isInstanceOf(IntermediateThrowNoneEventActivityBehavior.class);

        ProcessInstance instance = e.start("escalationThrow");
        assertThat(e.ended(instance.getId())).as("the token passes").isTrue();
        assertThat(e.visited(instance.getId())).contains("escalate", "end");
    }

    private static void compensationEndIsNone(N01Engine e) {
        EndEvent end = (EndEvent) e.element("compensateEnd", "comp");
        assertThat(end.getBehavior()).as("the compensate definition does not give the end event a behaviour of its own").isInstanceOf(NoneEndEventActivityBehavior.class);

        ProcessInstance instance = e.start("compensateEnd");
        assertThat(e.ended(instance.getId())).as("nothing is compensated, the instance just ends").isTrue();
        assertThat(e.visited(instance.getId())).contains("work", "comp");
    }

    // ---- artifacts ------------------------------------------------------------------------------------------------------------

    private static void groupIsDropped(N01Engine e) {
        Process process = e.process("group");
        assertThat(process.getArtifacts()).as("the group has no converter: it is not in the parsed process").isEmpty();
        assertThat(process.getFlowElement("grp")).isNull();

        assertThat(warnings(e, "group.bpmn20.xml")).as("only its diagram shape draws a validator warning")
                .containsExactly("DI_INVALID_REFERENCE: could not find grp");
        ProcessInstance instance = e.start("group");
        assertThat(e.ended(instance.getId())).isTrue();
    }

    private static void dataObjectReferenceWarns(N01Engine e) {
        Process process = e.process("dataObjectRef");
        assertThat(process.getFlowElement("orderRef")).as("a data object reference leaves no model element").isNull();

        assertThat(warnings(e, "data-object-reference.bpmn20.xml")).containsExactly("DI_INVALID_REFERENCE: could not find orderRef");
        ProcessInstance instance = e.start("dataObjectRef");
        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.variables(instance.getId())).as("the data object itself becomes a variable").containsEntry("order", null);
    }

    /** "KEY: description tail" of every finding, errors included, so that an unexpected error shows. */
    private static List<String> warnings(N01Engine e, String file) {
        List<ValidationError> findings = e.validate(file);
        assertThat(findings).as("the validator reports warnings only").allMatch(ValidationError::isWarning);
        return findings.stream().map(f -> f.getKey() + ": " + f.getDefaultDescription().replaceFirst("^.*(could not find )", "$1")).toList();
    }

    // ---- extensions entries that name nothing ---------------------------------------------------------------------------------

    private static void orphanKeysAreInert(N01Engine e) {
        assertThat(e.process("orphanKeys").getFlowElement("gone")).as("the mapping key names no element").isNull();
        assertThat(e.repository.createProcessDefinitionQuery().processDefinitionKey("otherProcess").count()).as("and the entry no process").isZero();

        ProcessInstance instance = e.start("orphanKeys");
        assertThat(e.ended(instance.getId())).isTrue();
        assertThat(e.visited(instance.getId())).contains("start", "work", "end");
        assertThat(e.variables(instance.getId())).as("nothing was mapped").isEmpty();
    }
}
