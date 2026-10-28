package io.github.kleash.activiti.dmn.kie;

import io.github.kleash.activiti.dmn.AbstractEvaluatorContractTest;
import io.github.kleash.activiti.dmn.DmnEvaluator;

/** Runs the shared evaluator contract (all hit policies, aggregators, DRD chaining, matched rules) against KIE. */
class KieEvaluatorContractTest extends AbstractEvaluatorContractTest {

    private final KieDmnEvaluator evaluator = new KieDmnEvaluator();

    @Override
    protected DmnEvaluator evaluator() {
        return evaluator;
    }
}
