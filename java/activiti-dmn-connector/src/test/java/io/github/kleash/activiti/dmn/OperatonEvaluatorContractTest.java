package io.github.kleash.activiti.dmn;

/** Runs the shared evaluator contract against the Operaton engine. */
class OperatonEvaluatorContractTest extends AbstractEvaluatorContractTest {

    private final OperatonDmnEvaluator evaluator = new OperatonDmnEvaluator();

    @Override
    protected DmnEvaluator evaluator() {
        return evaluator;
    }
}
