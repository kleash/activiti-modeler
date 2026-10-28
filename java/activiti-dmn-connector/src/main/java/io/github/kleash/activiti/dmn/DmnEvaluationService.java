package io.github.kleash.activiti.dmn;

import java.util.Map;
import java.util.Objects;

/**
 * Direct decision evaluation, outside any process instance. This is what the connector uses, and what the REST
 * endpoint {@code POST /decisions/evaluate} and the scenario runner's {@code decisions[]} use.
 *
 * <p>A decision can be given as a DMN document ({@link #evaluateXml}) or as a reference into a deployment
 * ({@link #evaluateInDeployment}), resolved with the three steps of {@link DmnDeploymentResolver}. Inputs named
 * {@code _activiti_*} are removed before evaluation, so the same map that a connector receives can be passed in.
 */
public class DmnEvaluationService {

    private final DmnEvaluator evaluator;
    private final DmnDeploymentResolver resolver;

    /**
     * Creates a service.
     *
     * @param evaluator the engine
     * @param resolver  resolves references against deployments
     */
    public DmnEvaluationService(DmnEvaluator evaluator, DmnDeploymentResolver resolver) {
        this.evaluator = Objects.requireNonNull(evaluator, "evaluator");
        this.resolver = Objects.requireNonNull(resolver, "resolver");
    }

    /** @return the engine in use */
    public DmnEvaluator evaluator() {
        return evaluator;
    }

    /** @return the resolver in use */
    public DmnDeploymentResolver resolver() {
        return resolver;
    }

    /**
     * Evaluates a decision of a DMN document.
     *
     * @param dmnXml      the DMN XML
     * @param decisionRef a decision id (or the definitions name); {@code null} selects the sink decision
     * @param inputs      the input variables
     * @return the evaluation
     */
    public DmnEvaluation evaluateXml(String dmnXml, String decisionRef, Map<String, Object> inputs) {
        return evaluator.evaluate(new DmnResource("inline.dmn", dmnXml), decisionRef, DmnOutputContract.decisionInputs(inputs));
    }

    /**
     * Checks that a DMN document is valid and that the engine in use can run it, without evaluating a decision.
     *
     * @param name resource name for messages
     * @param dmnXml the DMN XML
     * @throws DmnModelException when the document is invalid or uses constructs the engine cannot execute
     */
    public void validateXml(String name, String dmnXml) {
        evaluator.validate(new DmnResource(name, dmnXml));
    }

    /**
     * Evaluates a decision of a deployment.
     *
     * @param deploymentId the deployment holding the DMN resources
     * @param decisionRef  a resource base name, a definitions name or a decision id
     * @param inputs       the input variables
     * @return the evaluation
     * @throws DmnResolutionException when the reference does not select exactly one decision
     */
    public DmnEvaluation evaluateInDeployment(String deploymentId, String decisionRef, Map<String, Object> inputs) {
        DmnDeploymentResolver.Resolved resolved = resolver.resolve(deploymentId, decisionRef);
        return evaluator.evaluate(resolved.resource(), resolved.decision().id(), DmnOutputContract.decisionInputs(inputs));
    }
}
