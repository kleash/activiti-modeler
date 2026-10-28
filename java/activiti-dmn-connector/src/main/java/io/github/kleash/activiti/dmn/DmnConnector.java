package io.github.kleash.activiti.dmn;

import java.util.Map;
import java.util.Objects;

import org.activiti.api.process.model.IntegrationContext;
import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.ProcessDefinition;

/**
 * The Activiti {@link Connector} behind a decision task: a service task with
 * {@code implementation="dmn-connector.EXECUTE_TABLE"} (see docs/adr/0004-dmn-execution.md).
 *
 * <p>The decision is named by the constant {@value #DECISION_TABLE_CONSTANT} in the process extensions JSON and is
 * resolved against the DMN resources of the process definition's own deployment
 * ({@link DmnDeploymentResolver}). The connector's inbound variables, minus the reserved {@code _activiti_*}
 * constants, are the decision inputs. The outbound variables are defined by {@link DmnOutputContract} and reach the
 * process only through the task's output mappings.
 *
 * <p>A failing decision (no such decision, invalid DMN, two UNIQUE rules matched, ...) throws a
 * {@link DmnException}; like any service task exception it rolls the Activiti command back.
 */
public final class DmnConnector implements Connector {

    /** Name of the connector bean, and the value of {@code serviceTask/@implementation}. */
    public static final String IMPLEMENTATION = "dmn-connector.EXECUTE_TABLE";

    /** Constant in the extensions JSON that names the decision table to evaluate. */
    public static final String DECISION_TABLE_CONSTANT = "_activiti_dmn_table_";

    private final DmnEvaluationService service;
    private final RepositoryService repositoryService;
    private final LruCache<String, String> deploymentByDefinition;

    /**
     * Creates the connector.
     *
     * @param service           evaluates the decision
     * @param repositoryService maps a process definition to its deployment
     * @param cacheSize         how many process-definition-to-deployment lookups to cache
     */
    public DmnConnector(DmnEvaluationService service, RepositoryService repositoryService, int cacheSize) {
        this.service = Objects.requireNonNull(service, "service");
        this.repositoryService = Objects.requireNonNull(repositoryService, "repositoryService");
        this.deploymentByDefinition = new LruCache<>(cacheSize);
    }

    @Override
    public IntegrationContext apply(IntegrationContext context) {
        Map<String, Object> inbound = context.getInBoundVariables();
        Object reference = inbound.get(DECISION_TABLE_CONSTANT);
        String where = "Decision task '" + context.getClientId() + "' (process definition " + context.getProcessDefinitionId() + ")";
        if (reference == null || reference.toString().isBlank()) {
            throw new DmnResolutionException(where + " has no value for the constant " + DECISION_TABLE_CONSTANT
                + "; add it for this task in the process extensions JSON (constants)");
        }
        try {
            String deploymentId = deploymentByDefinition.get(context.getProcessDefinitionId(), this::deploymentOf);
            DmnEvaluation evaluation = service.evaluateInDeployment(deploymentId, reference.toString(), inbound);
            context.addOutBoundVariables(DmnOutputContract.outboundVariables(evaluation));
            return context;
        } catch (DmnResolutionException e) {
            throw new DmnResolutionException(where + ": " + e.getMessage());
        } catch (DmnModelException e) {
            throw new DmnModelException(where + ": " + e.getMessage(), e);
        } catch (DmnException e) {
            throw new DmnException(where + ": " + e.getMessage(), e);
        }
    }

    private String deploymentOf(String processDefinitionId) {
        ProcessDefinition definition = repositoryService.getProcessDefinition(processDefinitionId);
        return definition.getDeploymentId();
    }
}
