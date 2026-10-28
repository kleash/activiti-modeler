package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateTask;
import org.activiti.engine.delegate.TaskListener;

/**
 * Task listener (class or bean {@code recordingTaskListener}) that appends {@code "<event>:<task definition key>"} to
 * the process variable {@code taskListenerCalls}; for the {@code assignment} event the assignee is added:
 * {@code "assignment:<key>:<assignee>"}.
 */
public class RecordingTaskListener implements TaskListener {

    public static final String VARIABLE = "taskListenerCalls";

    @Override
    public void notify(DelegateTask task) {
        String entry = task.getEventName() + ":" + task.getTaskDefinitionKey();
        if (TaskListener.EVENTNAME_ASSIGNMENT.equals(task.getEventName())) {
            entry += ":" + task.getAssignee();
        }
        if (task.getExecution() != null) {
            CallLog.append(task.getExecution(), VARIABLE, entry);
        }
    }
}
