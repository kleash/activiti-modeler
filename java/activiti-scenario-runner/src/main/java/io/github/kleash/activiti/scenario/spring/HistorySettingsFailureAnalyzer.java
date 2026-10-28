package io.github.kleash.activiti.scenario.spring;

import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

import io.github.kleash.activiti.scenario.run.EngineSettings;

/** Turns the startup failure of a missing history setting into a plain "what to change" message. */
public class HistorySettingsFailureAnalyzer extends AbstractFailureAnalyzer<EngineSettings.InsufficientHistoryException> {

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure, EngineSettings.InsufficientHistoryException cause) {
        return new FailureAnalysis(cause.getMessage(), "Add the two properties above to application.properties (or the environment).", cause);
    }
}
