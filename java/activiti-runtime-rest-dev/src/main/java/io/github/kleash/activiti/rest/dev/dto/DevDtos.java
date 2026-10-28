package io.github.kleash.activiti.rest.dev.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;

import io.github.kleash.activiti.rest.core.dto.DefinitionDtos;
import io.github.kleash.activiti.rest.core.dto.StrictBody;
import io.github.kleash.activiti.scenario.report.FileReport;

/** Requests and responses of the development-only endpoints. */
public final class DevDtos {

    private DevDtos() {
    }

    /**
     * A project file.
     *
     * @param path    the name as it should be deployed, for example {@code processes/order.bpmn20.xml}; BPMN ends in {@code .bpmn20.xml}
     *                or {@code .bpmn}, the extensions JSON in {@code -extensions.json}, DMN in {@code .dmn}
     * @param content the text of the file
     */
    @StrictBody
    @Schema(requiredProperties = {"path", "content"})
    public record FileEntry(String path, String content) {
    }

    /** Body of {@code POST /dev/validate}. */
    @StrictBody
    @Schema(requiredProperties = {"files"})
    public record ValidateRequest(List<FileEntry> files) {
    }

    /**
     * One finding.
     *
     * @param path      the file it is about; {@code null} for the project as a whole
     * @param elementId the BPMN element, when the finding is about one
     * @param key       a stable key: the engine's problem key (for example {@code activiti-service-task-missing-implementation}) or one of
     *                  ours ({@code xsd}, {@code extensions-json}, {@code dmn-parse}, {@code trial-deploy}, ...)
     * @param severity  {@code error} (the project does not deploy or run), {@code warning} or {@code info}
     * @param message   what is wrong; asynchronous-executor warnings say that they exist only because the executor is off
     * @param source    which check found it: {@code xsd}, {@code engine-validate}, {@code trial-deploy}, {@code extensions}, {@code dmn}, {@code request}
     * @param line      line in the file, when known
     * @param column    column in the file, when known
     */
    @Schema(requiredProperties = {"key", "severity", "message", "source"})
    public record Problem(String path, String elementId, String key, String severity, String message, String source, Integer line, Integer column) {
    }

    /**
     * Result of a validation.
     *
     * @param valid               {@code true} when there is no problem of severity {@code error}
     * @param asyncExecutorActive whether the async executor of this server runs; when it is off the engine warns about asynchronous elements
     * @param checked             the files that were checked
     * @param problems            the findings
     */
    @Schema(requiredProperties = {"valid", "asyncExecutorActive", "checked", "problems"})
    public record ValidateResponse(boolean valid, boolean asyncExecutorActive, List<String> checked, List<Problem> problems) {
    }

    /**
     * Body of {@code POST /dev/deployments}.
     *
     * @param name  the deployment name; defaults to {@code modeler-<time>}
     * @param files the project files, deployed as one deployment
     */
    @StrictBody
    @Schema(requiredProperties = {"files"})
    public record DeployRequest(String name, List<FileEntry> files) {
    }

    /**
     * @param id           process definition id
     * @param key          process definition key
     * @param name         name
     * @param version      version
     * @param resourceName the BPMN resource
     */
    @Schema(requiredProperties = {"id", "key", "version", "resourceName"})
    public record DeployedDefinition(String id, String key, String name, int version, String resourceName) {
    }

    /**
     * Result of a deployment.
     *
     * @param deploymentId the deployment
     * @param name         its name
     * @param resources    resource names as stored
     * @param definitions  the process definitions it created
     * @param decisions    the DMN decisions in it
     * @param problems     warnings found on the way (errors refuse the deployment with 422)
     */
    @Schema(requiredProperties = {"deploymentId", "resources", "definitions", "decisions", "problems"})
    public record DeployResponse(String deploymentId, String name, List<String> resources, List<DeployedDefinition> definitions,
                                 List<DefinitionDtos.DecisionResource> decisions, List<Problem> problems) {
    }

    /**
     * Body of {@code POST /dev/scenarios/run}.
     *
     * @param files    the project files; deployed for the run and removed afterwards
     * @param scenario the scenario file (see docs/user-guide/scenarios.md) as a JSON object or as text
     */
    @StrictBody
    @Schema(requiredProperties = {"files", "scenario"})
    public record ScenarioRunRequest(List<FileEntry> files, JsonNode scenario) {
    }

    /**
     * Result of a scenario run.
     *
     * @param passed         whether every scenario and decision case passed
     * @param report         the step-by-step report
     * @param rendered       the report as text
     * @param durationMillis wall-clock time including the deployment and its removal
     */
    @Schema(requiredProperties = {"passed", "report", "rendered", "durationMillis"})
    public record ScenarioRunResponse(boolean passed, FileReport report, String rendered, long durationMillis) {
    }

    /**
     * Body of {@code POST /dev/decisions/evaluate}: a DMN document or a deployment, not both.
     *
     * @param dmn          DMN XML
     * @param deploymentId a deployment that holds {@code .dmn} resources
     * @param decisionRef  a decision id; with a deployment also a DMN file base name or a definitions name; without it the document's only top-level decision
     * @param inputs       the input variables
     */
    @StrictBody
    public record DecisionRequest(String dmn, String deploymentId, String decisionRef, Map<String, Object> inputs) {
    }

    /**
     * @param decisionId   the decision
     * @param decisionName its name
     * @param kind         {@code DECISION_TABLE} or {@code LITERAL_EXPRESSION}
     * @param hitPolicy    hit policy of a table
     * @param aggregation  aggregation of a COLLECT table
     * @param multiResult  whether the decision yields a list
     * @param rows         result rows
     * @param matchedRules ids of the rules that produced the rows, in result order
     */
    @Schema(requiredProperties = {"decisionId", "kind", "multiResult", "rows", "matchedRules"})
    public record DecisionStep(String decisionId, String decisionName, String kind, String hitPolicy, String aggregation, boolean multiResult,
                               List<Map<String, Object>> rows, List<String> matchedRules) {
    }

    /**
     * Result of a decision evaluation.
     *
     * @param decisionId   the requested decision
     * @param matched      whether it matched
     * @param rows         its result rows
     * @param matchedRules ids of the matched rules
     * @param engine       the DMN engine
     * @param decisions    every decision evaluated on the way, required decisions first
     */
    @Schema(requiredProperties = {"decisionId", "matched", "rows", "matchedRules", "engine", "decisions"})
    public record DecisionOutcome(String decisionId, boolean matched, List<Map<String, Object>> rows, List<String> matchedRules, String engine,
                                  List<DecisionStep> decisions) {
    }

    /**
     * @param path     path below the workspace root, with {@code /}
     * @param type     {@code file} or {@code directory}
     * @param size     size in bytes of a file
     * @param modified last modification
     */
    @Schema(requiredProperties = {"path", "type"})
    public record WorkspaceEntry(String path, String type, Long size, Instant modified) {
    }

    /**
     * @param path    the listed directory ({@code ""} for the root)
     * @param entries files and directories, directories first, sorted by path
     */
    @Schema(requiredProperties = {"path", "entries"})
    public record WorkspaceListing(String path, List<WorkspaceEntry> entries) {
    }
}
