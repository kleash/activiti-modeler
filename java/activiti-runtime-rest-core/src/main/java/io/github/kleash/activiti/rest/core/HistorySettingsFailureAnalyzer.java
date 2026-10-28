package io.github.kleash.activiti.rest.core;

import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

/** Prints {@link HistorySettingsCheck}'s message as a startup failure analysis instead of a stack trace. */
public final class HistorySettingsFailureAnalyzer extends AbstractFailureAnalyzer<HistorySettingsCheck.InsufficientHistoryException> {

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure, HistorySettingsCheck.InsufficientHistoryException cause) {
        return new FailureAnalysis(cause.getMessage(), "Set spring.activiti.history-level=full and spring.activiti.db-history-used=true.", cause);
    }
}
