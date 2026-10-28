package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.DelegateTask;

/**
 * Bean {@code listenerRecorder}: lets an <em>expression</em> listener record like the recording listener classes.
 *
 * <p>An expression cannot call {@code recordingExecutionListener.notify(execution)}: the engine's expression resolver blocks
 * the name {@code notify} because it is also a final native method of {@code Object}. This bean offers the same recording
 * under other names:
 * <ul>
 *   <li>{@code ${listenerRecorder.recordExecution(execution)}} behaves like {@link RecordingExecutionListener};</li>
 *   <li>{@code ${listenerRecorder.recordTask(task)}} behaves like {@link RecordingTaskListener}.</li>
 * </ul>
 */
public class ListenerRecorder {

    private final RecordingExecutionListener executionListener = new RecordingExecutionListener();
    private final RecordingTaskListener taskListener = new RecordingTaskListener();

    public void recordExecution(DelegateExecution execution) {
        executionListener.notify(execution);
    }

    public void recordTask(DelegateTask task) {
        taskListener.notify(task);
    }
}
