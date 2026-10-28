package io.github.kleash.activiti.scenario.recording;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;

import org.activiti.engine.delegate.event.ActivitiEvent;
import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.engine.delegate.event.ActivitiEventType;
import org.activiti.engine.delegate.event.ActivitiSequenceFlowTakenEvent;
import org.activiti.engine.impl.context.Context;
import org.activiti.engine.impl.interceptor.CommandContext;
import org.activiti.engine.impl.interceptor.CommandContextCloseListener;

/**
 * Global engine event listener that records every {@code SEQUENCEFLOW_TAKEN} event (fired in
 * {@code ContinueProcessOperation}). Events become visible only when the engine command that fired them commits, so a
 * rolled-back call (for example a {@code completeTask} that {@code expectFailure}s) leaves no phantom flows behind.
 */
public final class SequenceFlowRecorder implements ActivitiEventListener {

    /** One taken sequence flow. */
    public record TakenFlow(String processInstanceId, String processDefinitionId, String flowId) {
    }

    private static final String ATTRIBUTE = SequenceFlowRecorder.class.getName() + ".pending";
    private static final int CAPACITY = 200_000;

    private final ConcurrentLinkedQueue<TakenFlow> committed = new ConcurrentLinkedQueue<>();

    @Override
    public void onEvent(ActivitiEvent event) {
        if (event.getType() != ActivitiEventType.SEQUENCEFLOW_TAKEN || !(event instanceof ActivitiSequenceFlowTakenEvent flow)) {
            return;
        }
        TakenFlow taken = new TakenFlow(event.getProcessInstanceId(), event.getProcessDefinitionId(), flow.getId());
        CommandContext commandContext = Context.getCommandContext();
        if (commandContext == null) {
            publish(List.of(taken));
            return;
        }
        PendingFlows pending = commandContext.getGenericAttribute(ATTRIBUTE);
        if (pending == null) {
            pending = new PendingFlows();
            commandContext.addAttribute(ATTRIBUTE, pending);
            commandContext.addCloseListener(pending);
        }
        pending.flows.add(taken);
    }

    @Override
    public boolean isFailOnException() {
        return false;
    }

    /** Flows taken by the given process instances, in the order they were taken. */
    public List<TakenFlow> flowsOf(Collection<String> instanceIds) {
        return committed.stream().filter(f -> instanceIds.contains(f.processInstanceId())).toList();
    }

    /** Forgets the flows of the given instances (a scenario run is over). */
    public void clear(Collection<String> instanceIds) {
        committed.removeIf(f -> instanceIds.contains(f.processInstanceId()));
    }

    private void publish(List<TakenFlow> flows) {
        committed.addAll(flows);
        while (committed.size() > CAPACITY) {
            committed.poll();
        }
    }

    private final class PendingFlows implements CommandContextCloseListener {
        private final List<TakenFlow> flows = new ArrayList<>();

        @Override public void closing(CommandContext commandContext) { /* nothing to do */ }

        @Override public void afterSessionsFlush(CommandContext commandContext) { /* nothing to do */ }

        @Override public void closed(CommandContext commandContext) { publish(flows); }

        @Override public void closeFailure(CommandContext commandContext) { flows.clear(); }
    }
}
