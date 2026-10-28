package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.JavaDelegate;

/**
 * {@code activiti:class} delegate. Field {@code variable} (name, expression): adds 1 to that process variable
 * (a missing variable counts as 0).
 */
public class IncrementDelegate implements JavaDelegate {

    private Expression variable;

    public void setVariable(Expression variable) {
        this.variable = variable;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String name = String.valueOf(variable.getValue(execution));
        Object current = execution.getVariable(name);
        execution.setVariable(name, (current == null ? 0 : ((Number) current).intValue()) + 1);
    }
}
