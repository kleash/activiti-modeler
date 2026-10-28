package io.github.kleash.activiti.rest.core.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import org.activiti.engine.delegate.event.ActivitiEvent;
import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.engine.delegate.event.ActivitiEventType;
import org.activiti.engine.delegate.event.ActivitiSequenceFlowTakenEvent;
import org.activiti.engine.impl.context.Context;
import org.activiti.engine.impl.interceptor.CommandContext;
import org.activiti.engine.impl.interceptor.CommandContextCloseListener;

/**
 * Records the sequence flows that process instances take. The engine's history keeps the activities an instance entered but
 * not the flows between them; the engine fires {@code SEQUENCEFLOW_TAKEN} for each one (in {@code ContinueProcessOperation}),
 * and this listener (registered as a typed global listener) keeps them per instance, in memory and bounded.
 *
 * <p>Flows become visible when the engine command that took them commits, so a rolled-back call leaves nothing behind.
 * Instances this JVM did not see (started before a restart) have no record; {@code InstanceViews} then infers the flows from the model.
 */
public final class SequenceFlowTracker implements ActivitiEventListener {

    /** One taken flow. */
    public record Taken(long order, String flowId, String sourceActivityId, String targetActivityId, Instant time) {
    }

    private static final String ATTRIBUTE = SequenceFlowTracker.class.getName() + ".pending";

    private final int maxFlowsPerInstance;
    private final AtomicLong sequence = new AtomicLong();
    private final Map<String, List<Taken>> byInstance;

    public SequenceFlowTracker(int maxInstances, int maxFlowsPerInstance) {
        this.maxFlowsPerInstance = maxFlowsPerInstance;
        this.byInstance = new LinkedHashMap<>(256, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, List<Taken>> eldest) {
                return size() > maxInstances;
            }
        };
    }

    @Override
    public void onEvent(ActivitiEvent event) {
        if (event.getType() != ActivitiEventType.SEQUENCEFLOW_TAKEN || !(event instanceof ActivitiSequenceFlowTakenEvent flow)
                || event.getProcessInstanceId() == null) {
            return;
        }
        Pending item = new Pending(event.getProcessInstanceId(),
                new Taken(sequence.incrementAndGet(), flow.getId(), flow.getSourceActivityId(), flow.getTargetActivityId(), Instant.now()));
        CommandContext commandContext = Context.getCommandContext();
        if (commandContext == null) {
            publish(List.of(item));
            return;
        }
        PendingFlows pending = commandContext.getGenericAttribute(ATTRIBUTE);
        if (pending == null) {
            pending = new PendingFlows();
            commandContext.addAttribute(ATTRIBUTE, pending);
            commandContext.addCloseListener(pending);
        }
        pending.items.add(item);
    }

    @Override
    public boolean isFailOnException() {
        return false;
    }

    /** @return the flows the instance took, in order; empty when none was recorded */
    public List<Taken> flowsOf(String processInstanceId) {
        synchronized (byInstance) {
            List<Taken> flows = byInstance.get(processInstanceId);
            return flows == null ? List.of() : List.copyOf(flows);
        }
    }

    /** Drops what is recorded for an instance (for tests, and for hosts that purge instances). */
    public void forget(String processInstanceId) {
        synchronized (byInstance) {
            byInstance.remove(processInstanceId);
        }
    }

    private void publish(List<Pending> items) {
        synchronized (byInstance) {
            for (Pending item : items) {
                List<Taken> flows = byInstance.computeIfAbsent(item.instanceId, k -> new ArrayList<>());
                if (flows.size() < maxFlowsPerInstance) {
                    flows.add(item.taken);
                }
            }
        }
    }

    private record Pending(String instanceId, Taken taken) {
    }

    private final class PendingFlows implements CommandContextCloseListener {

        private final List<Pending> items = new ArrayList<>();

        @Override
        public void closing(CommandContext commandContext) {
            // nothing to do
        }

        @Override
        public void afterSessionsFlush(CommandContext commandContext) {
            // nothing to do
        }

        @Override
        public void closed(CommandContext commandContext) {
            publish(items);
        }

        @Override
        public void closeFailure(CommandContext commandContext) {
            items.clear();
        }
    }
}
