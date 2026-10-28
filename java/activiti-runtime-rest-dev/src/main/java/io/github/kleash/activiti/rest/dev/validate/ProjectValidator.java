package io.github.kleash.activiti.rest.dev.validate;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.activiti.bpmn.converter.BpmnXMLConverter;
import org.activiti.bpmn.exceptions.XMLException;
import org.activiti.bpmn.model.BpmnModel;
import org.activiti.bpmn.model.FlowElement;
import org.activiti.bpmn.model.Process;
import org.activiti.bpmn.model.ServiceTask;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.RepositoryService;
import org.activiti.spring.process.ProcessExtensionResourceReader;
import org.activiti.validation.ValidationError;
import org.xml.sax.SAXParseException;

import com.fasterxml.jackson.core.JsonLocation;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.dmn.DmnEvaluationService;
import io.github.kleash.activiti.dmn.DmnModel;
import io.github.kleash.activiti.rest.core.service.DefinitionService;
import io.github.kleash.activiti.rest.dev.dto.DevDtos;

/**
 * Checks a project before it is deployed. Every check that the engine or the runtime performs at some point is performed here, with
 * the engine's own code and without side effects:
 * <ol>
 *   <li><b>XSD</b> and structure of each BPMN file ({@link BpmnXMLConverter} with schema validation, as the deployment does);</li>
 *   <li><b>{@code RepositoryService.validateProcess}</b> of the running engine, with its validators (so the modeler server's own rules
 *       are in it); the warnings that exist only because the async executor is off are labelled as such;</li>
 *   <li>a <b>dry load of every {@code -extensions.json}</b> by the runtime's own {@link ProcessExtensionResourceReader}, plus checks the
 *       reader cannot make (unknown process, unknown element, output target that is not declared and would be dropped silently);</li>
 *   <li>a <b>DMN parse</b> by the DMN engine in use, including constructs that engine cannot execute;</li>
 *   <li>decision tasks whose decision cannot be found in the DMN files of the project;</li>
 *   <li>a <b>trial deployment</b> into a scratch engine ({@link TrialDeployer}), which finds what only the deployment step finds
 *       (a {@code businessRuleTask} makes it fail with a {@code NullPointerException}, for example).</li>
 * </ol>
 */
public class ProjectValidator {

    private static final Set<String> ASYNC_KEYS = Set.of("activiti-flow-element-async-not-available", "activiti-event-timer-async-not-available",
            "activiti-signal-async-not-available");
    private static final Pattern SAX_POSITION = Pattern.compile("lineNumber: (\\d+); columnNumber: (\\d+); (.*)", Pattern.DOTALL);
    private static final String DMN_CONNECTOR = "dmn-connector.EXECUTE_TABLE";
    private static final String DMN_CONSTANT = "_activiti_dmn_table_";

    /**
     * What a validation found.
     *
     * @param problems the findings
     * @param checked  the files that were looked at
     * @param models   the BPMN models that parsed, by file path
     */
    public record Result(List<DevDtos.Problem> problems, List<String> checked, Map<String, BpmnModel> models) {

        public boolean hasErrors() {
            return problems.stream().anyMatch(p -> "error".equals(p.severity()));
        }
    }

    private final RepositoryService repository;
    private final ProcessEngineConfiguration configuration;
    private final ProcessExtensionResourceReader extensionsReader;
    private final DmnEvaluationService dmn;
    private final ObjectMapper mapper;
    private final TrialDeployer trial;

    public ProjectValidator(RepositoryService repository, ProcessEngineConfiguration configuration, ProcessExtensionResourceReader extensionsReader,
                            DmnEvaluationService dmn, ObjectMapper mapper, TrialDeployer trial) {
        this.repository = repository;
        this.configuration = configuration;
        this.extensionsReader = extensionsReader;
        this.dmn = dmn;
        this.mapper = mapper;
        this.trial = trial;
    }

    /** @return whether the async executor of the running engine is running */
    public boolean asyncExecutorActive() {
        return configuration.getAsyncExecutor() != null && configuration.getAsyncExecutor().isActive();
    }

    /**
     * @param files       the project
     * @param trialDeploy whether to also deploy into a scratch engine (skip it when the project is about to be deployed for real)
     */
    public Result validate(List<DevDtos.FileEntry> files, boolean trialDeploy) {
        List<DevDtos.Problem> problems = new ArrayList<>();
        List<String> checked = new ArrayList<>();
        List<DevDtos.FileEntry> bpmn = new ArrayList<>();
        List<DevDtos.FileEntry> extensions = new ArrayList<>();
        List<DevDtos.FileEntry> dmnFiles = new ArrayList<>();
        sort(files, problems, bpmn, extensions, dmnFiles);

        Map<String, BpmnModel> models = new LinkedHashMap<>();
        for (DevDtos.FileEntry file : bpmn) {
            checked.add(file.path());
            checkBpmn(file, models, problems);
        }
        for (DevDtos.FileEntry file : dmnFiles) {
            checked.add(file.path());
            checkDmn(file, problems);
        }
        Map<String, JsonNode> extensionDocs = new LinkedHashMap<>();
        for (DevDtos.FileEntry file : extensions) {
            checked.add(file.path());
            checkExtensions(file, models, extensionDocs, problems);
        }
        checkDecisionReferences(models, extensionDocs, dmnFiles, problems);

        if (trialDeploy) {
            List<DevDtos.FileEntry> deployable = bpmn.stream().filter(f -> models.containsKey(f.path())).toList();
            List<DevDtos.FileEntry> others = new ArrayList<>(extensions);
            others.addAll(dmnFiles);
            problems.addAll(trial.trial(deployable, others));
        }
        return new Result(problems, checked, models);
    }

    // ---- request ------------------------------------------------------------------------------------------------------------

    private static void sort(List<DevDtos.FileEntry> files, List<DevDtos.Problem> problems, List<DevDtos.FileEntry> bpmn,
                             List<DevDtos.FileEntry> extensions, List<DevDtos.FileEntry> dmn) {
        if (files == null || files.isEmpty()) {
            throw new IllegalArgumentException("files is empty: give at least one project file");
        }
        Set<String> seen = new HashSet<>();
        for (DevDtos.FileEntry file : files) {
            if (file == null || file.path() == null || file.path().isBlank()) {
                throw new IllegalArgumentException("Every file needs a path");
            }
            if (file.content() == null) {
                throw new IllegalArgumentException("File '" + file.path() + "' has no content");
            }
            if (!seen.add(file.path())) {
                problems.add(new DevDtos.Problem(file.path(), null, "duplicate-path", "error",
                        "The path '" + file.path() + "' is given more than once; a deployment holds one resource per name", "request", null, null));
                continue;
            }
            switch (DefinitionService.kindOfName(file.path())) {
                case "bpmn" -> bpmn.add(file);
                case "extensions" -> extensions.add(file);
                case "dmn" -> dmn.add(file);
                default -> problems.add(new DevDtos.Problem(file.path(), null, "unknown-file-type", "info",
                        "Not a BPMN (.bpmn20.xml, .bpmn), DMN (.dmn) or extensions (-extensions.json) file: it is ignored", "request", null, null));
            }
        }
    }

    // ---- BPMN ---------------------------------------------------------------------------------------------------------------

    private void checkBpmn(DevDtos.FileEntry file, Map<String, BpmnModel> models, List<DevDtos.Problem> problems) {
        byte[] bytes = file.content().getBytes(StandardCharsets.UTF_8);
        BpmnModel model;
        try {
            model = new BpmnXMLConverter().convertToBpmnModel(() -> new ByteArrayInputStream(bytes), true, false);
        } catch (XMLException e) {
            problems.add(xmlProblem(file.path(), e));
            return;
        } catch (RuntimeException e) {
            problems.add(new DevDtos.Problem(file.path(), null, "bpmn-parse", "error", TrialDeployer.describe(e), "xsd", null, null));
            return;
        }
        if (model.getProcesses().isEmpty()) {
            problems.add(new DevDtos.Problem(file.path(), null, "no-process", "error", "The file contains no <process>", "engine-validate", null, null));
            return;
        }
        models.put(file.path(), model);
        boolean executorOff = !asyncExecutorActive();
        for (ValidationError error : repository.validateProcess(model)) {
            boolean asyncOnly = ASYNC_KEYS.contains(error.getProblem());
            String message = error.getDefaultDescription() + (asyncOnly && executorOff
                    ? " (reported only because the async executor of this engine is off; with the executor running there is no such warning)" : "");
            problems.add(new DevDtos.Problem(file.path(), error.getActivityId(), error.getProblem(), error.isWarning() ? "warning" : "error", message,
                    "engine-validate", error.getXmlLineNumber() > 0 ? error.getXmlLineNumber() : null,
                    error.getXmlColumnNumber() > 0 ? error.getXmlColumnNumber() : null));
        }
    }

    private static DevDtos.Problem xmlProblem(String path, XMLException e) {
        String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        Integer line = null;
        Integer column = null;
        for (Throwable cause = e; cause != null; cause = cause.getCause() == cause ? null : cause.getCause()) {
            if (cause instanceof SAXParseException sax && sax.getLineNumber() > 0) {
                line = sax.getLineNumber();
                column = sax.getColumnNumber() > 0 ? sax.getColumnNumber() : null;
                break;
            }
        }
        Matcher position = SAX_POSITION.matcher(message);
        if (position.find()) {
            line = line != null ? line : Integer.valueOf(position.group(1));
            column = column != null ? column : Integer.valueOf(position.group(2));
            message = position.group(3).strip();
        }
        boolean schema = message.startsWith("cvc-");
        return new DevDtos.Problem(path, null, schema ? "xsd" : "bpmn-parse", "error", schema ? "Not valid BPMN 2.0: " + message : message, "xsd", line, column);
    }

    // ---- extensions ---------------------------------------------------------------------------------------------------------

    private void checkExtensions(DevDtos.FileEntry file, Map<String, BpmnModel> models, Map<String, JsonNode> docs, List<DevDtos.Problem> problems) {
        byte[] bytes = file.content().getBytes(StandardCharsets.UTF_8);
        try {
            docs.put(file.path(), mapper.readTree(bytes));
            // the runtime's own reader: what it cannot read, the process cannot start with
            extensionsReader.read(new ByteArrayInputStream(bytes));
        } catch (JsonProcessingException e) {
            JsonLocation where = e.getLocation();
            docs.remove(file.path());
            problems.add(new DevDtos.Problem(file.path(), null, "extensions-json", "error",
                    "The runtime cannot read this extensions file: " + e.getOriginalMessage(), "extensions",
                    where == null || where.getLineNr() < 1 ? null : where.getLineNr(), where == null || where.getColumnNr() < 1 ? null : where.getColumnNr()));
            return;
        } catch (IOException | RuntimeException e) {
            docs.remove(file.path());
            problems.add(new DevDtos.Problem(file.path(), null, "extensions-json", "error", "The runtime cannot read this extensions file: " + TrialDeployer.describe(e),
                    "extensions", null, null));
            return;
        }
        crossCheckExtensions(file.path(), docs.get(file.path()), models, problems);
    }

    /** Warnings the reader cannot give: the file refers to things that are not there, or sets outputs that would be dropped. */
    private void crossCheckExtensions(String path, JsonNode document, Map<String, BpmnModel> models, List<DevDtos.Problem> problems) {
        JsonNode all = document.path("extensions");
        if (!all.isObject()) {
            problems.add(new DevDtos.Problem(path, null, "extensions-empty", "warning",
                    "The file has no \"extensions\" object: it configures no process", "extensions", null, null));
            return;
        }
        Iterator<Map.Entry<String, JsonNode>> processes = all.fields();
        while (processes.hasNext()) {
            Map.Entry<String, JsonNode> entry = processes.next();
            String processId = entry.getKey();
            JsonNode extension = entry.getValue();
            Process process = findProcess(models, processId);
            if (process == null) {
                if (!models.isEmpty()) {
                    problems.add(new DevDtos.Problem(path, null, "extensions-unknown-process", "warning",
                            "The extensions are for the process '" + processId + "', which is in none of the BPMN files of this project", "extensions", null, null));
                }
                continue;
            }
            Set<String> declared = new HashSet<>();
            extension.path("properties").forEach(p -> declared.add(p.path("name").asText()));
            for (String section : List.of("mappings", "constants")) {
                Iterator<Map.Entry<String, JsonNode>> elements = extension.path(section).fields();
                while (elements.hasNext()) {
                    Map.Entry<String, JsonNode> element = elements.next();
                    if (process.getFlowElement(element.getKey(), true) == null) {
                        problems.add(new DevDtos.Problem(path, element.getKey(), "extensions-unknown-element", "warning",
                                "The " + section + " of '" + element.getKey() + "' belong to no element of the process '" + processId + "'", "extensions", null, null));
                    }
                }
            }
            Iterator<Map.Entry<String, JsonNode>> mappings = extension.path("mappings").fields();
            while (mappings.hasNext()) {
                Map.Entry<String, JsonNode> mapping = mappings.next();
                Iterator<String> targets = mapping.getValue().path("outputs").fieldNames();
                while (targets.hasNext()) {
                    String target = targets.next();
                    if (!declared.contains(target)) {
                        problems.add(new DevDtos.Problem(path, mapping.getKey(), "extensions-undeclared-output", "warning",
                                "The output mapping of '" + mapping.getKey() + "' writes the variable '" + target + "', which is not declared in \"properties\" of '"
                                        + processId + "'; the engine drops an output whose target is not declared", "extensions", null, null));
                    }
                }
            }
        }
    }

    private static Process findProcess(Map<String, BpmnModel> models, String id) {
        for (BpmnModel model : models.values()) {
            Process process = model.getProcessById(id);
            if (process != null) {
                return process;
            }
        }
        return null;
    }

    // ---- DMN ----------------------------------------------------------------------------------------------------------------

    private void checkDmn(DevDtos.FileEntry file, List<DevDtos.Problem> problems) {
        try {
            dmn.validateXml(file.path(), file.content());
        } catch (RuntimeException e) {
            problems.add(new DevDtos.Problem(file.path(), null, "dmn-parse", "error", e.getMessage() == null ? TrialDeployer.describe(e) : e.getMessage(),
                    "dmn", null, null));
        }
    }

    /** A decision task names its decision in the extensions; with DMN files in the project the name must resolve (resource name, model name or decision id). */
    private void checkDecisionReferences(Map<String, BpmnModel> models, Map<String, JsonNode> docs, List<DevDtos.FileEntry> dmnFiles, List<DevDtos.Problem> problems) {
        Set<String> known = new HashSet<>();
        for (DevDtos.FileEntry file : dmnFiles) {
            try {
                DmnModel model = DmnModel.parse(file.content());
                String name = file.path().substring(Math.max(file.path().lastIndexOf('/'), file.path().lastIndexOf('\\')) + 1);
                known.add(name.endsWith(".dmn") ? name.substring(0, name.length() - 4) : name);
                known.add(model.definitionsName());
                model.decisions().forEach(d -> known.add(d.id()));
            } catch (RuntimeException e) {
                // reported by checkDmn
            }
        }
        for (Map.Entry<String, BpmnModel> entry : models.entrySet()) {
            for (Process process : entry.getValue().getProcesses()) {
                for (FlowElement element : process.findFlowElementsOfType(ServiceTask.class, true)) {
                    if (!DMN_CONNECTOR.equals(((ServiceTask) element).getImplementation())) {
                        continue;
                    }
                    JsonNode value = constantOf(docs, process.getId(), element.getId());
                    if (value == null) {
                        problems.add(new DevDtos.Problem(entry.getKey(), element.getId(), "dmn-constant-missing", "warning",
                                "The decision task '" + element.getId() + "' has no constant " + DMN_CONSTANT + " in the extensions of '" + process.getId()
                                        + "': the connector will not know which decision to evaluate", "extensions", null, null));
                    } else if (!dmnFiles.isEmpty() && !known.contains(value.asText())) {
                        problems.add(new DevDtos.Problem(entry.getKey(), element.getId(), "dmn-decision-not-found", "warning",
                                "The decision task '" + element.getId() + "' refers to '" + value.asText() + "', which is no DMN file name, model name or decision id in the DMN files of this project "
                                        + known, "dmn", null, null));
                    }
                }
            }
        }
    }

    private static JsonNode constantOf(Map<String, JsonNode> docs, String processId, String elementId) {
        for (JsonNode doc : docs.values()) {
            JsonNode value = doc.path("extensions").path(processId).path("constants").path(elementId).path(DMN_CONSTANT).path("value");
            if (!value.isMissingNode() && !value.isNull()) {
                return value;
            }
        }
        return null;
    }
}
