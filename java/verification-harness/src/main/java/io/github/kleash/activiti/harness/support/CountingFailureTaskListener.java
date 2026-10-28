package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateTask;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.TaskListener;

/**
 * Bean {@code countingFailureTaskListener}: the task listener twin of {@link CountingFailureDelegate}, for a failure on a
 * user task (a non-service element). Fields {@code failing} (boolean, default true) and {@code message}; a failing call throws
 * {@code IllegalStateException("<message> (attempt <n>)")}, counted per process instance and task definition key. The engine
 * wraps it as "Exception while invoking TaskListener: ...", so the message of the failed job still carries the attempt.
 */
public class CountingFailureTaskListener implements TaskListener {

    private final AttemptCounter counter;
    private Expression failing;
    private Expression message;

    public CountingFailureTaskListener(AttemptCounter counter) {
        this.counter = counter;
    }

    public void setFailing(Expression failing) {
        this.failing = failing;
    }

    public void setMessage(Expression message) {
        this.message = message;
    }

    @Override
    public void notify(DelegateTask task) {
        Object value = failing != null ? failing.getValue(task) : null;
        if (failing == null || value == null || Boolean.parseBoolean(String.valueOf(value))) {
            int attempt = counter.next(task.getProcessInstanceId() + ":" + task.getTaskDefinitionKey());
            throw new IllegalStateException(CountingFailureDelegate.text(message, task, "service unavailable") + " (attempt " + attempt + ")");
        }
    }
}
