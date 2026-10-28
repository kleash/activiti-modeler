package io.github.kleash.activiti.harness.n01;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;

import org.activiti.bpmn.model.EndEvent;
import org.activiti.bpmn.model.FieldExtension;
import org.activiti.bpmn.model.IntermediateCatchEvent;
import org.activiti.bpmn.model.MessageEventDefinition;
import org.activiti.bpmn.model.SignalEventDefinition;
import org.activiti.bpmn.model.StartEvent;
import org.activiti.bpmn.model.ThrowEvent;
import org.activiti.engine.impl.bpmn.behavior.AbstractThrowMessageEventActivityBehavior;
import org.activiti.engine.impl.bpmn.behavior.NoneEndEventActivityBehavior;
import org.activiti.engine.impl.delegate.DefaultThrowMessageJavaDelegate;
import org.activiti.engine.runtime.Job;
import org.activiti.engine.runtime.ProcessInstance;

/** Signals, messages and timers: what the engine does not throw, subscribe or fire. */
final class EventChecks {

    private EventChecks() {
    }

    static void register(Map<String, N01Check> checks) {
        N01Checks.put(checks, "signal-end-throws-nothing", EventChecks::signalEndThrowsNothing);
        N01Checks.put(checks, "signal-start-in-esp-has-no-behaviour", EventChecks::signalStartInEspHasNoBehaviour);
        N01Checks.put(checks, "signal-start-in-esp-never-starts", EventChecks::signalStartInEspNeverStarts);
        N01Checks.put(checks, "signal-expression-catch-waits-and-passes", EventChecks::signalExpressionCatchWaitsAndPasses);
        N01Checks.put(checks, "signal-expression-catch-leaves-a-stale-subscription", EventChecks::signalExpressionLeavesStaleSubscription);
        N01Checks.put(checks, "message-field-is-not-injected", EventChecks::messageFieldIsNotInjected);
        N01Checks.put(checks, "multiple-event-definitions-use-only-the-first", EventChecks::multipleDefinitionsUseOnlyTheFirst);
        N01Checks.put(checks, "link-end-event-is-a-none-end", EventChecks::linkEndIsNoneEnd);
        N01Checks.put(checks, "timer-end-date-before-due-date-is-dropped", EventChecks::timerEndDateBeforeDueDateIsDropped);
    }

    // ---- signal end event: nothing is thrown -------------------------------------------------------------------------------------

    private static void signalEndThrowsNothing(N01Engine e) {
        EndEvent end = (EndEvent) e.element("signalEnd", "raise");
        assertThat(end.getEventDefinitions()).as("the definition is parsed ...").hasSize(1).first().isInstanceOf(SignalEventDefinition.class);
        assertThat(end.getBehavior()).as("... and the end event behaves like a none end event").isInstanceOf(NoneEndEventActivityBehavior.class);

        ProcessInstance waiter = e.start("signalWaiter");
        assertThat(e.waitingAt(waiter.getId())).containsExactly("wait");

        ProcessInstance thrower = e.start("signalEnd");
        assertThat(e.ended(thrower.getId())).as("the end event ends the instance").isTrue();
        assertThat(e.visited(thrower.getId())).contains("work", "raise");

        e.drive(waiter.getId());
        assertThat(e.running(waiter.getId())).as("no signal 'go' arrived: the waiting instance did not move").isTrue();
        assertThat(e.waitingAt(waiter.getId())).containsExactly("wait");

        // the waiter listens: a signal that is thrown does wake it
        e.runtime.signalEventReceived("go");
        assertThat(e.ended(waiter.getId())).as("control: the helper process does react to a real signal").isTrue();
    }

    // ---- signal start in an event sub process ------------------------------------------------------------------------------------

    private static void signalStartInEspHasNoBehaviour(N01Engine e) {
        StartEvent start = (StartEvent) e.element("signalStartEsp", "espStart");
        assertThat(start.getEventDefinitions()).as("the validator accepts it, the definition is parsed").hasSize(1).first().isInstanceOf(SignalEventDefinition.class);
        assertThat(start.getBehavior()).as("but no behaviour is attached: only message and error starts have one in an event sub process").isNull();

        ProcessInstance instance = e.start("signalStartEsp");
        assertThat(e.ended(instance.getId())).as("work is a pass-through task: the instance ends at once").isTrue();
        assertThat(e.visited(instance.getId())).doesNotContain("espStart", "espTask");
    }

    /** Variant with a user task as {@code work}, so that the instance is still alive when the signal is sent. */
    private static void signalStartInEspNeverStarts(N01Engine e) {
        ProcessInstance instance = e.start("signalStartEsp");
        assertThat(e.waitingAt(instance.getId())).containsExactly("work");
        assertThat(e.subscriptionsOf(instance.getId())).as("no signal subscription was created for the event sub process").isEmpty();
        List<?> engineWide = e.management.executeCommand(c -> c.getEventSubscriptionEntityManager().findSignalEventSubscriptionsByEventName("go", null));
        assertThat(engineWide).as("no signal subscription of the name exists in the engine").isEmpty();

        e.runtime.signalEventReceived("go");

        assertThat(e.running(instance.getId())).isTrue();
        assertThat(e.waitingAt(instance.getId())).as("the broadcast did nothing").containsExactly("work");
        assertThat(e.visited(instance.getId())).doesNotContain("espStart", "espTask", "espEnd");
        assertThat(e.visited(instance.getId())).as("nothing but the start and the user task").containsExactly("start", "work");
    }

    // ---- signal named by an expression -------------------------------------------------------------------------------------------

    private static void signalExpressionCatchWaitsAndPasses(N01Engine e) {
        IntermediateCatchEvent event = (IntermediateCatchEvent) e.element("sigExprCatch", "catch");
        assertThat(event.getEventDefinitions()).first().isInstanceOf(SignalEventDefinition.class);

        ProcessInstance instance = e.start("sigExprCatch", Map.of("region", "go"));
        assertThat(e.waitingAt(instance.getId())).containsExactly("catch");
        assertThat(e.subscriptionsOf(instance.getId())).containsExactly("signal:go@catch");

        e.runtime.signalEventReceived("go");

        assertThat(e.ended(instance.getId())).as("the catch event passes; the instance ends, so nothing stale can be seen on this model").isTrue();
    }

    /** Variant: a user task follows the catch event; the execution lives on and so does the subscription (finding 29). */
    private static void signalExpressionLeavesStaleSubscription(N01Engine e) {
        ProcessInstance instance = e.start("sigExprStale", Map.of("region", "go"));
        assertThat(e.subscriptionsOf(instance.getId())).containsExactly("signal:go@catch");

        e.runtime.signalEventReceived("go");

        assertThat(e.waitingAt(instance.getId())).as("the event was passed").containsExactly("after");
        assertThat(e.subscriptionsOf(instance.getId())).as("but its subscription is still there").containsExactly("signal:go@catch");
        assertThatThrownBy(() -> e.runtime.signalEventReceived("go"))
                .as("the second broadcast signals whatever the execution waits at")
                .hasStackTraceContaining("UserTask should not be signalled before complete");
        assertThat(e.waitingAt(instance.getId())).as("the failed broadcast rolled back").containsExactly("after");
    }

    // ---- message throw with a field -----------------------------------------------------------------------------------------------

    private static void messageFieldIsNotInjected(N01Engine e) throws ReflectiveOperationException {
        ThrowEvent event = (ThrowEvent) e.element("messageField", "say");
        MessageEventDefinition definition = (MessageEventDefinition) event.getEventDefinitions().get(0);
        assertThat(definition.getFieldExtensions()).as("the field is parsed into the model").extracting(FieldExtension::getFieldName, FieldExtension::getStringValue)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("to", "ann"));

        Field delegate = AbstractThrowMessageEventActivityBehavior.class.getDeclaredField("delegate");
        delegate.setAccessible(true);
        assertThat(delegate.get(event.getBehavior())).as("the throw event has no delegate to inject it into: the engine's default one sends nothing")
                .isInstanceOf(DefaultThrowMessageJavaDelegate.class);

        ProcessInstance instance = e.start("messageField");
        assertThat(e.ended(instance.getId())).as("the throw event passes").isTrue();
        assertThat(e.variables(instance.getId())).as("nothing recorded, nothing sent").isEmpty();
    }

    // ---- timer start whose end date is before its first due date ----------------------------------------------------------------

    private static void timerEndDateBeforeDueDateIsDropped(N01Engine e) {
        String definitionId = e.definition("timerEndDate").getId();
        List<Job> before = e.management.createTimerJobQuery().processDefinitionId(definitionId).list();
        assertThat(before).as("the timer job exists after the deployment").hasSize(1);
        assertThat(before.get(0).getDuedate()).as("due in 2031, after the end date 2030").hasYear(2031);

        e.driver.fireStartTimer("timerEndDate", "start");

        assertThat(e.instancesOf("timerEndDate")).as("no instance was started").isEmpty();
        assertThat(e.finishedInstancesOf("timerEndDate")).isZero();
        assertThat(e.management.createTimerJobQuery().processDefinitionId(definitionId).count()).as("the job is gone, it was not rescheduled").isZero();
        assertThat(e.management.createJobQuery().processDefinitionId(definitionId).count()).isZero();
    }

    // ---- an event with several definitions -----------------------------------------------------------------------------------------

    private static void multipleDefinitionsUseOnlyTheFirst(N01Engine e) {
        for (String id : List.of("multi", "both")) {
            IntermediateCatchEvent event = (IntermediateCatchEvent) e.element("multipleEvents", id);
            assertThat(event.getEventDefinitions()).as(id + ": both definitions are in the parsed model").hasSize(2);
            assertThat(event.getEventDefinitions().get(0)).isInstanceOf(org.activiti.bpmn.model.TimerEventDefinition.class);
            assertThat(event.getEventDefinitions().get(1)).isInstanceOf(SignalEventDefinition.class);
        }

        ProcessInstance instance = e.start("multipleEvents");
        String id = instance.getId();
        assertThat(e.waitingAt(id)).containsExactly("multi");
        assertThat(e.subscriptionsOf(id)).as("the behaviour is the first definition's, the timer: no signal subscription").isEmpty();
        assertThat(e.jobsOf(id)).hasSize(1).first().asString().endsWith("@multi");

        e.runtime.signalEventReceived("go");
        assertThat(e.waitingAt(id)).as("the signal does not release the event").containsExactly("multi");

        e.driver.fireTimer(e.scope(id), "multi", false);
        assertThat(e.waitingAt(id)).as("the timer does").containsExactly("both");
        assertThat(e.subscriptionsOf(id)).as("parallelMultiple is not read: the second event is the first definition's, too").isEmpty();

        e.runtime.signalEventReceived("go");
        assertThat(e.waitingAt(id)).containsExactly("both");
        e.driver.fireTimer(e.scope(id), "both", false);
        assertThat(e.ended(id)).isTrue();
    }

    // ---- link definition on an end event ---------------------------------------------------------------------------------------------

    private static void linkEndIsNoneEnd(N01Engine e) {
        EndEvent jump = (EndEvent) e.element("linkEnd", "jump");
        assertThat(jump.getBehavior()).as("whatever the definition: a none end event").isInstanceOf(NoneEndEventActivityBehavior.class);

        ProcessInstance instance = e.start("linkEnd");

        assertThat(e.ended(instance.getId())).as("the instance ends at the end event").isTrue();
        assertThat(e.visited(instance.getId())).contains("work", "jump").doesNotContain("landing", "after", "end");
    }
}
