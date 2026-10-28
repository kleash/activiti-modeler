package io.github.kleash.activiti.rest.core.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;

/** Deployments, process definitions and what belongs to them. */
public final class DefinitionDtos {

    private DefinitionDtos() {
    }

    /**
     * @param id             deployment id
     * @param name           deployment name
     * @param deploymentTime when it was deployed
     * @param category       category
     * @param key            deployment key
     * @param tenantId       tenant
     */
    @Schema(requiredProperties = {"id"})
    public record Deployment(String id, String name, Instant deploymentTime, String category, String key, String tenantId) {
    }

    /**
     * @param name resource name exactly as stored in the deployment (Spring auto-deployment stores absolute paths)
     * @param kind {@code bpmn}, {@code dmn}, {@code extensions} (a {@code *-extensions.json}), {@code image} or {@code other}
     */
    @Schema(requiredProperties = {"name", "kind"})
    public record DeploymentResource(String name, String kind) {
    }

    /**
     * @param id                 process definition id
     * @param key                process definition key
     * @param name               name
     * @param description        description
     * @param version            version of this key
     * @param deploymentId       the deployment it belongs to
     * @param resourceName       the BPMN resource of the deployment
     * @param diagramResourceName a generated diagram resource, if any
     * @param category           the target namespace of the BPMN
     * @param suspended          whether new instances are refused
     * @param tenantId           tenant
     * @param hasStartFormKey    whether the start event names a form
     * @param runningInstances   number of running instances; only with {@code includeCounts=true}
     */
    @Schema(requiredProperties = {"id", "key", "version", "deploymentId", "resourceName", "suspended", "hasStartFormKey"})
    public record ProcessDefinition(
            String id,
            String key,
            String name,
            String description,
            int version,
            String deploymentId,
            String resourceName,
            String diagramResourceName,
            String category,
            boolean suspended,
            String tenantId,
            boolean hasStartFormKey,
            Long runningInstances) {
    }

    /**
     * The extensions JSON (variable properties, mappings, constants) of one process definition.
     *
     * @param resourceName the {@code *-extensions.json} resource it was read from
     * @param extensions   the entry of the process definition key, as in the file
     */
    @Schema(requiredProperties = {"resourceName", "extensions"})
    public record DefinitionExtensions(String resourceName, JsonNode extensions) {
    }

    /**
     * @param resourceName    the DMN resource
     * @param definitionsName {@code definitions/@name}
     * @param decisions       the decisions in the file
     * @param error           why the file could not be read, {@code null} when it could
     */
    @Schema(requiredProperties = {"resourceName", "decisions"})
    public record DecisionResource(String resourceName, String definitionsName, List<DecisionInfo> decisions, String error) {
    }

    /**
     * @param id          decision id (what {@code _activiti_dmn_table_} names)
     * @param name        decision name
     * @param kind        {@code DECISION_TABLE}, {@code LITERAL_EXPRESSION}, {@code OTHER_BOXED_EXPRESSION} or {@code NONE}
     * @param hitPolicy   hit policy of a decision table
     * @param aggregation aggregation of a COLLECT table
     * @param inputCount  number of input columns
     * @param outputs     output column names
     * @param ruleIds     rule ids in rule order
     * @param requires    ids of the decisions this one requires
     */
    @Schema(requiredProperties = {"id", "kind", "inputCount", "outputs", "ruleIds", "requires"})
    public record DecisionInfo(
            String id,
            String name,
            String kind,
            String hitPolicy,
            String aggregation,
            int inputCount,
            List<String> outputs,
            List<String> ruleIds,
            List<String> requires) {
    }

    /**
     * Result of {@code GET /process-definitions/{id}/decisions}.
     *
     * @param dmnAvailable whether the DMN connector is on the class path (without it the list is empty)
     * @param resources    the DMN resources of the definition's deployment
     */
    @Schema(requiredProperties = {"dmnAvailable", "resources"})
    public record DefinitionDecisions(boolean dmnAvailable, List<DecisionResource> resources) {
    }
}
