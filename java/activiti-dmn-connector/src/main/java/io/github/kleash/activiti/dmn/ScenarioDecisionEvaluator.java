package io.github.kleash.activiti.dmn;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.Deployment;

import io.github.kleash.activiti.scenario.run.DecisionEvaluator;

/**
 * Adapter that lets the scenario runner's {@code decisions[]} section run on the DMN connector: it implements the
 * runner's {@link DecisionEvaluator} port over {@link DmnEvaluationService}. The runner has no DMN dependency; this
 * class lives here, is only loaded when the scenario runner is on the classpath, and is registered by
 * {@link DmnConnectorAutoConfiguration}.
 *
 * <p>The reference of a decision case ({@code decision} in the scenario file) is resolved like the constant
 * {@code _activiti_dmn_table_} of a decision task (resource base name, definitions name or decision id, see
 * {@link DmnDeploymentResolver}), against the DMN resources of the <b>newest deployment that can resolve it</b>. In a
 * harness project context there is exactly one deployment; in a long running server the newest one wins.
 */
public final class ScenarioDecisionEvaluator implements DecisionEvaluator {

    private final DmnEvaluationService service;
    private final RepositoryService repositoryService;

    /**
     * Creates the adapter.
     *
     * @param service           evaluates a decision of a deployment
     * @param repositoryService lists the deployments
     */
    public ScenarioDecisionEvaluator(DmnEvaluationService service, RepositoryService repositoryService) {
        this.service = Objects.requireNonNull(service, "service");
        this.repositoryService = Objects.requireNonNull(repositoryService, "repositoryService");
    }

    @Override
    public Outcome evaluate(String decision, Map<String, Object> inputs) {
        List<Deployment> deployments = repositoryService.createDeploymentQuery().orderByDeploymentId().desc().list();
        if (deployments.isEmpty()) {
            throw new DmnResolutionException("Cannot evaluate decision '" + decision + "': nothing is deployed");
        }
        List<String> misses = new ArrayList<>();
        for (Deployment deployment : deployments) {
            DmnEvaluation evaluation;
            try {
                evaluation = service.evaluateInDeployment(deployment.getId(), decision, inputs);
            } catch (DmnResolutionException e) {
                // this deployment has no (unique) such decision: try the next older one
                misses.add("deployment " + deployment.getId() + ": " + e.getMessage());
                continue;
            }
            return new Outcome(evaluation.rows(), evaluation.matchedRules());
        }
        throw new DmnResolutionException("Decision '" + decision + "' was not found in any of the " + deployments.size()
            + " deployment(s): " + String.join(" | ", misses));
    }
}
