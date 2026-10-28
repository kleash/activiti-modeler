package io.github.kleash.activiti.harness.support;

import java.util.Map;

import org.activiti.bpmn.model.FlowElement;
import org.activiti.bpmn.model.Task;
import org.activiti.engine.delegate.TransactionDependentExecutionListener;
import org.activiti.engine.delegate.TransactionDependentTaskListener;

/**
 * Transaction-dependent listeners that record into {@link TransactionListenerLog}. The engine does not tell a listener in
 * which phase it runs, so there is one bean per phase and the entry starts with the phase:
 * {@code "<phase>:<element id>:<resolvedBy>"}, where {@code resolvedBy} comes from the custom properties map
 * ({@code none} when the listener declares no custom properties resolver).
 */
public final class RecordingTransactionListeners {

    private RecordingTransactionListeners() {
    }

    /** Execution listener for {@code onTransaction}; the phase is fixed per instance. */
    public static final class ExecutionPhase implements TransactionDependentExecutionListener {

        private final String phase;
        private final TransactionListenerLog log;

        public ExecutionPhase(String phase, TransactionListenerLog log) {
            this.phase = phase;
            this.log = log;
        }

        @Override
        public void notify(String processInstanceId, String executionId, FlowElement flowElement,
                           Map<String, Object> executionVariables, Map<String, Object> customPropertiesMap) {
            log.record(processInstanceId, phase + ":" + flowElement.getId() + ":" + resolvedBy(customPropertiesMap));
        }
    }

    /** Task listener for {@code onTransaction}; the phase is fixed per instance. */
    public static final class TaskPhase implements TransactionDependentTaskListener {

        private final String phase;
        private final TransactionListenerLog log;

        public TaskPhase(String phase, TransactionListenerLog log) {
            this.phase = phase;
            this.log = log;
        }

        @Override
        public void notify(String processInstanceId, String executionId, Task task,
                           Map<String, Object> executionVariables, Map<String, Object> customPropertiesMap) {
            log.record(processInstanceId, phase + ":" + task.getId() + ":" + resolvedBy(customPropertiesMap));
        }
    }

    private static String resolvedBy(Map<String, Object> customPropertiesMap) {
        Object value = customPropertiesMap != null ? customPropertiesMap.get("resolvedBy") : null;
        return value != null ? String.valueOf(value) : "none";
    }
}
