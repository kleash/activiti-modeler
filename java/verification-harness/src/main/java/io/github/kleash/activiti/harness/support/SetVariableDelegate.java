package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.JavaDelegate;

/**
 * {@code activiti:class} delegate. Fields {@code variable} (name) and {@code value}, both expressions: sets the process
 * variable {@code variable} to the evaluated {@code value}.
 */
public class SetVariableDelegate implements JavaDelegate {

    private Expression variable;
    private Expression value;

    public void setVariable(Expression variable) {
        this.variable = variable;
    }

    public void setValue(Expression value) {
        this.value = value;
    }

    @Override
    public void execute(DelegateExecution execution) {
        execution.setVariable(String.valueOf(variable.getValue(execution)), value.getValue(execution));
    }
}
