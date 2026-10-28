package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.event.ActivitiActivityEvent;
import org.activiti.engine.delegate.event.ActivitiEntityEvent;
import org.activiti.engine.delegate.event.ActivitiEvent;
import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.engine.delegate.event.ActivitiEventType;
import org.activiti.engine.impl.context.Context;
import org.activiti.engine.impl.persistence.entity.ExecutionEntity;
import org.activiti.engine.task.Task;

/**
 * Engine event listener (class or bean {@code recordingEventListener}) that appends {@code "<EVENT_TYPE>[:<id>]"} to
 * the process variable {@code eventListenerCalls} of the event's process instance: the activity id for activity
 * events, the task definition key for task events. Variable events are not recorded (they would recurse).
 */
public class RecordingEventListener implements ActivitiEventListener {

    public static final String VARIABLE = "eventListenerCalls";

    private static final ThreadLocal<Boolean> RECORDING = ThreadLocal.withInitial(() -> false);

    @Override
    public void onEvent(ActivitiEvent event) {
        if (RECORDING.get() || event.getProcessInstanceId() == null || isVariableEvent(event)) {
            return;
        }
        ExecutionEntity instance = Context.getCommandContext().getExecutionEntityManager().findById(event.getProcessInstanceId());
        if (instance == null) {
            return;
        }
        RECORDING.set(true);
        try {
            CallLog.append(instance, VARIABLE, describe(event));
        } finally {
            RECORDING.set(false);
        }
    }

    private static boolean isVariableEvent(ActivitiEvent event) {
        ActivitiEventType type = event.getType();
        if (type != null && type.name().startsWith("VARIABLE_")) {
            return true;
        }
        return event instanceof ActivitiEntityEvent entity && entity.getEntity() instanceof org.activiti.engine.impl.persistence.entity.VariableInstance;
    }

    private static String describe(ActivitiEvent event) {
        String type = event.getType().name();
        if (event instanceof ActivitiActivityEvent activity && activity.getActivityId() != null) {
            return type + ":" + activity.getActivityId();
        }
        if (event instanceof ActivitiEntityEvent entity && entity.getEntity() instanceof Task task && task.getTaskDefinitionKey() != null) {
            return type + ":" + task.getTaskDefinitionKey();
        }
        return type;
    }

    @Override
    public boolean isFailOnException() {
        return true;
    }
}
