package io.github.kleash.activiti.harness.dmn;

import java.util.Map;

import io.github.kleash.activiti.dmn.DmnEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.DmnResource;

/** Wraps the project's {@link DmnEvaluator}: behaviour is unchanged, every call (and its failure) is logged. */
public final class RecordingDmnEvaluator implements DmnEvaluator {

    private final DmnEvaluator delegate;
    private final DmnEvaluationLog log;

    public RecordingDmnEvaluator(DmnEvaluator delegate, DmnEvaluationLog log) {
        this.delegate = delegate;
        this.log = log;
    }

    /** The engine of the project (what a decision task really runs on). */
    public DmnEvaluator delegate() {
        return delegate;
    }

    @Override
    public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
        try {
            DmnEvaluation evaluation = delegate.evaluate(dmn, decisionRef, inputs);
            log.record(dmn, decisionRef, inputs, null);
            return evaluation;
        } catch (RuntimeException e) {
            log.record(dmn, decisionRef, inputs, e);
            throw e;
        }
    }

    @Override
    public String engineName() {
        return delegate.engineName();
    }
}
