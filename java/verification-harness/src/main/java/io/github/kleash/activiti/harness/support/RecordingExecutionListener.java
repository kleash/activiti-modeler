package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.ExecutionListener;
import org.activiti.engine.impl.persistence.entity.ExecutionEntity;

/**
 * Execution listener (class or bean {@code recordingExecutionListener}) that appends
 * {@code "<event>:<element id>"} to the process variable {@code executionListenerCalls}. The element is the activity for
 * start/end events and the sequence flow for {@code take}; for the process itself the process definition key.
 */
public class RecordingExecutionListener implements ExecutionListener {

    public static final String VARIABLE = "executionListenerCalls";

    @Override
    public void notify(DelegateExecution execution) {
        String element = execution.getCurrentFlowElement() != null ? execution.getCurrentFlowElement().getId() : null;
        if (element == null && execution instanceof ExecutionEntity entity && entity.getProcessDefinitionKey() != null) {
            element = entity.getProcessDefinitionKey();
        }
        CallLog.append(execution, VARIABLE, execution.getEventName() + ":" + element);
    }
}
