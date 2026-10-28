package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateTask;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.TaskListener;

/**
 * Task listener (class) with injected fields. Field {@code tag} (expression, required): appends
 * {@code "<tag>:<event>:<task definition key>"} to the process variable {@code fieldListenerCalls}. It shows that
 * {@code <activiti:field>} values reach task listeners.
 */
public class FieldTaskListener implements TaskListener {

    public static final String VARIABLE = "fieldListenerCalls";

    private Expression tag;

    public void setTag(Expression tag) {
        this.tag = tag;
    }

    @Override
    public void notify(DelegateTask task) {
        String entry = tag.getValue(task) + ":" + task.getEventName() + ":" + task.getTaskDefinitionKey();
        if (task.getExecution() != null) {
            CallLog.append(task.getExecution(), VARIABLE, entry);
        }
    }
}
