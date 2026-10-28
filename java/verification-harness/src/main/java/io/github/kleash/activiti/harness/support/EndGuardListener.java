package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.ExecutionListener;
import org.activiti.engine.delegate.Expression;

/**
 * Makes a <em>process-level end listener</em> observable. The engine runs process {@code end} listeners after it has deleted
 * the process instance execution, so such a listener cannot write process variables (the insert violates the foreign key to
 * the deleted execution and the whole completion fails). Instead of recording, this listener fails on request: it throws
 * {@code IllegalStateException("process end listener ran: <type>")} when the business key of the process instance is
 * {@code fail-<type>}, where {@code type} is the field {@code type} (class, delegate expression) or the argument of
 * {@link #check} (expression). Any other business key (or none) leaves the listener silent.
 *
 * <p>Use it as the class, as the bean {@code endGuard} ({@code activiti:delegateExpression="${endGuard}"}, field {@code type})
 * or as {@code activiti:expression="${endGuard.check(execution, 'expression')}"}.
 */
public class EndGuardListener implements ExecutionListener {

    private Expression type;

    public void setType(Expression type) {
        this.type = type;
    }

    @Override
    public void notify(DelegateExecution execution) {
        check(execution, type != null ? String.valueOf(type.getValue(execution)) : "unknown");
    }

    /** Throws when the process instance business key is {@code fail-<listenerType>}. */
    public void check(DelegateExecution execution, String listenerType) {
        if (("fail-" + listenerType).equals(execution.getProcessInstanceBusinessKey())) {
            throw new IllegalStateException("process end listener ran: " + listenerType);
        }
    }
}
