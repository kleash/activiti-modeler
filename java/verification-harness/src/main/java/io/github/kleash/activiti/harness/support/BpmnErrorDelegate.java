package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.BpmnError;
import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.JavaDelegate;

/**
 * {@code activiti:class} delegate. Field {@code errorCode} (expression, default {@code DELEGATE_ERROR}): always throws
 * a {@link BpmnError} with that code.
 */
public class BpmnErrorDelegate implements JavaDelegate {

    private Expression errorCode;

    public void setErrorCode(Expression errorCode) {
        this.errorCode = errorCode;
    }

    @Override
    public void execute(DelegateExecution execution) {
        throw new BpmnError(errorCode != null ? String.valueOf(errorCode.getValue(execution)) : "DELEGATE_ERROR", "bpmn error from delegate");
    }
}
