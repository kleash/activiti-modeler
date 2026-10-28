package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.JavaDelegate;

/**
 * {@code activiti:class} delegate. Field {@code message} (expression, default {@code boom}): always throws an
 * {@link IllegalStateException} with that message.
 */
public class ThrowingDelegate implements JavaDelegate {

    private Expression message;

    public void setMessage(Expression message) {
        this.message = message;
    }

    @Override
    public void execute(DelegateExecution execution) {
        throw new IllegalStateException(message != null ? String.valueOf(message.getValue(execution)) : "boom");
    }
}
