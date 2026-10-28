package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.ExecutionListener;
import org.activiti.engine.impl.persistence.entity.ExecutionEntity;

/**
 * Execution listener that shows {@code <activiti:field>} values reaching listeners. Class or bean
 * {@code fieldExecutionListener}; field {@code tag} (an expression, required). Appends
 * {@code "<tag>:<event>:<element id>"} to the process variable {@code fieldExecutionListenerCalls}.
 */
public class FieldExecutionListener implements ExecutionListener {

    public static final String VARIABLE = "fieldExecutionListenerCalls";

    private Expression tag;

    public void setTag(Expression tag) {
        this.tag = tag;
    }

    @Override
    public void notify(DelegateExecution execution) {
        String element = execution.getCurrentFlowElement() != null ? execution.getCurrentFlowElement().getId() : null;
        if (element == null && execution instanceof ExecutionEntity entity) {
            element = entity.getProcessDefinitionKey();
        }
        Object value = tag != null ? tag.getValue(execution) : null;
        CallLog.append(execution, VARIABLE, value + ":" + execution.getEventName() + ":" + element);
    }
}
