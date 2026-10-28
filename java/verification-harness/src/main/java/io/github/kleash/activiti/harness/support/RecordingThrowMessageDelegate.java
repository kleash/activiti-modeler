package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.impl.delegate.ThrowMessage;
import org.activiti.engine.impl.delegate.ThrowMessageDelegate;

/**
 * The throw-message delegate for {@code messageEventDefinition activiti:delegateExpression="${recordingThrowMessageDelegate}"}
 * (the engine's default one sends nothing). It appends the message name to the process variable {@code thrownMessages}
 * and stores the payload, correlation key and business key of the last throw in {@code thrownMessagePayload},
 * {@code thrownMessageCorrelationKey} and {@code thrownMessageBusinessKey} (only when present). It returns {@code true}.
 */
public class RecordingThrowMessageDelegate implements ThrowMessageDelegate {

    public static final String VARIABLE = "thrownMessages";

    @Override
    public boolean send(DelegateExecution execution, ThrowMessage message) {
        CallLog.append(execution, VARIABLE, message.getName());
        message.getPayload().ifPresent(payload -> execution.setVariable("thrownMessagePayload", new java.util.HashMap<>(payload)));
        message.getCorrelationKey().ifPresent(key -> execution.setVariable("thrownMessageCorrelationKey", key));
        message.getBusinessKey().ifPresent(key -> execution.setVariable("thrownMessageBusinessKey", key));
        return true;
    }
}
