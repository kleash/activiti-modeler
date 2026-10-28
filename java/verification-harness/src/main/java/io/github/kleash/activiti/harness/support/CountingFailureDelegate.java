package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.JavaDelegate;

/**
 * Bean {@code countingFailure} for {@code activiti:delegateExpression="${countingFailure}"}: fails like a flaky service and
 * counts its attempts in the {@link AttemptCounter}.
 *
 * <p>Fields (expressions, evaluated per call): {@code failing} (boolean; the task fails when true, the default is true) and
 * {@code message} (default {@code service unavailable}). A failing call throws
 * {@code IllegalStateException("<message> (attempt <n>)")}; a call that does not fail appends
 * {@code "<task id>:passed"} to the list variable {@code countingFailureCalls}.
 */
public class CountingFailureDelegate implements JavaDelegate {

    public static final String VARIABLE = "countingFailureCalls";

    private final AttemptCounter counter;
    private Expression failing;
    private Expression message;

    public CountingFailureDelegate(AttemptCounter counter) {
        this.counter = counter;
    }

    public void setFailing(Expression failing) {
        this.failing = failing;
    }

    public void setMessage(Expression message) {
        this.message = message;
    }

    @Override
    public void execute(DelegateExecution execution) {
        if (isFailing(execution)) {
            int attempt = counter.next(execution.getProcessInstanceId() + ":" + execution.getCurrentActivityId());
            throw new IllegalStateException(text(message, execution, "service unavailable") + " (attempt " + attempt + ")");
        }
        CallLog.append(execution, VARIABLE, execution.getCurrentActivityId() + ":passed");
    }

    private boolean isFailing(DelegateExecution execution) {
        if (failing == null) {
            return true;
        }
        Object value = failing.getValue(execution);
        return value == null || Boolean.parseBoolean(String.valueOf(value));
    }

    static String text(Expression expression, org.activiti.engine.delegate.VariableScope scope, String fallback) {
        if (expression == null) {
            return fallback;
        }
        Object value = expression.getValue(scope);
        return value == null ? fallback : String.valueOf(value);
    }
}
