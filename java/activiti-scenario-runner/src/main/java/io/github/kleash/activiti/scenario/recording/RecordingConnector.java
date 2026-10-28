package io.github.kleash.activiti.scenario.recording;

import java.util.LinkedHashMap;
import java.util.Map;

import org.activiti.api.process.model.IntegrationContext;
import org.activiti.api.process.runtime.connector.Connector;

import io.github.kleash.activiti.scenario.match.ValueMatcher;

/**
 * Wraps a {@link Connector} bean and records the inbound variables of every call for {@code expectConnectorCall}
 * steps. Behaviour is unchanged: the wrapped connector runs with the very same integration context and its result is
 * returned as is; exceptions propagate after being noted.
 */
public final class RecordingConnector implements Connector {

    private final String beanName;
    private final Connector delegate;
    private final ConnectorCallRecorder recorder;

    public RecordingConnector(String beanName, Connector delegate, ConnectorCallRecorder recorder) {
        this.beanName = beanName;
        this.delegate = delegate;
        this.recorder = recorder;
    }

    /** The wrapped connector. */
    public Connector delegate() {
        return delegate;
    }

    @Override
    public IntegrationContext apply(IntegrationContext context) {
        ConnectorCall call = new ConnectorCall(recorder.nextSequence(), context.getProcessInstanceId(), context.getClientId(),
                context.getClientName(), context.getConnectorType() != null ? context.getConnectorType() : beanName,
                copy(context.getInBoundVariables()));
        recorder.record(call);
        try {
            IntegrationContext result = delegate.apply(context);
            call.completed(copy(result != null ? result.getOutBoundVariables() : null));
            return result;
        } catch (RuntimeException | Error e) {
            call.failed(e);
            throw e;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> copy(Map<String, Object> variables) {
        if (variables == null) {
            return Map.of();
        }
        return (Map<String, Object>) ValueMatcher.normalize(new LinkedHashMap<>(variables));
    }
}
