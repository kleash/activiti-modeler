package io.github.kleash.activiti.harness.verify;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

import org.activiti.bpmn.converter.BpmnXMLConverter;
import org.activiti.bpmn.converter.util.InputStreamProvider;
import org.activiti.bpmn.model.BpmnModel;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.Deployment;
import org.activiti.engine.repository.ProcessDefinition;
import org.activiti.validation.ValidationError;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.context.ProjectContext;

/**
 * Assertions about what actually reached the engine (docs/adr/0003-model-file-contract.md, "Consequences"): the
 * deployment holds exactly the project's files under their <em>base names</em> (Spring auto-deployment stores
 * absolute paths), including {@code .dmn} and {@code -extensions.json}, with the content unchanged and readable through
 * {@code RepositoryService.getResourceAsStream}, and it created exactly the expected process definition keys.
 */
final class DeploymentChecks {

    /** The validator warnings that appear only because the async executor is off (docs/adr/0005). */
    static final java.util.Set<String> EXPECTED_ASYNC_WARNING_KEYS = java.util.Set.of(
            "FLOW_ELEMENT_ASYNC_NOT_AVAILABLE", "EVENT_TIMER_ASYNC_NOT_AVAILABLE", "SIGNAL_ASYNC_NOT_AVAILABLE");

    /** Not an error: the engine skips processes with isExecutable="false" (collaboration pools drawn for documentation). */
    static final String NOT_EXECUTABLE_WARNING_KEY = "PROCESS_DEFINITION_NOT_EXECUTABLE";

    /**
     * The diagram interchange of data object references, data store references and data associations: the engine
     * keeps no model element (or no flow node) for them, so its validator warns about their BPMNDI shapes and edges
     * (docs/engine-findings.md, C18.2). Only the warnings that name such an element of the same file are expected.
     */
    static final java.util.Set<String> EXPECTED_DATA_DI_WARNING_KEYS = java.util.Set.of("DI_INVALID_REFERENCE", "DI_DOES_NOT_REFERENCE_FLOWNODE");

    private static final java.util.regex.Pattern DATA_ELEMENT_ID = java.util.regex.Pattern.compile(
            "<(?:\\w+:)?(?:dataObjectReference|dataStoreReference|dataInputAssociation|dataOutputAssociation)\\b[^>]*?\\bid=\"([^\"]+)\"");

    private static final String BPMN_NAMESPACE ="http://www.omg.org/spec/BPMN/20100524/MODEL";

    private DeploymentChecks() {
    }

    /** @return the problems found; empty when the deployment is as expected */
    static List<String> verifyDeployment(ProjectContext context) {
        List<String> problems = new ArrayList<>();
        Path processes = context.project().processesDir();
        RepositoryService repository = context.bean(RepositoryService.class);
        Deployment deployment = context.deployment();

        // 1. resource names
        List<Path> files = ProjectContext.deployableFiles(processes);
        Map<String, Path> expected = new TreeMap<>();
        for (Path file : files) {
            expected.put(processes.relativize(file).toString().replace('\\', '/'), file);
        }
        List<String> actualNames = repository.getDeploymentResourceNames(deployment.getId());
        TreeSet<String> actualBaseNames = new TreeSet<>();
        actualNames.forEach(n -> actualBaseNames.add(baseName(n)));
        TreeSet<String> expectedBaseNames = new TreeSet<>();
        expected.keySet().forEach(n -> expectedBaseNames.add(baseName(n)));
        if (!expectedBaseNames.equals(actualBaseNames)) {
            TreeSet<String> missing = new TreeSet<>(expectedBaseNames);
            missing.removeAll(actualBaseNames);
            TreeSet<String> unexpected = new TreeSet<>(actualBaseNames);
            unexpected.removeAll(expectedBaseNames);
            problems.add("Deployment resources (by base name) differ from the files in " + processes + ": missing " + missing
                    + ", unexpected " + unexpected + ". Deployed: " + actualNames
                    + (missing.stream().anyMatch(n -> n.endsWith(".dmn"))
                            ? " (.dmn files are deployed only when **.dmn is among spring.activiti.process-definition-location-suffixes)" : ""));
        }
        if (actualNames.size() != new TreeSet<>(actualNames).size()) {
            problems.add("Deployment has duplicate resource names: " + actualNames);
        }

        // 2. how the names are stored
        if (context.mode() == DeployMode.AUTO_DEPLOY) {
            actualNames.stream().filter(n -> !Path.of(n).isAbsolute())
                    .forEach(n -> problems.add("Spring auto-deployment stores absolute file paths as resource names, but '" + n + "' is not absolute"));
        } else {
            TreeSet<String> names = new TreeSet<>(actualNames);
            if (!names.equals(new TreeSet<>(expected.keySet()))) {
                problems.add("Programmatic deployment resource names should be " + expected.keySet() + " but are " + names);
            }
        }

        // 3. content readable and unchanged
        for (String name : actualNames) {
            Path source = expected.get(name);
            if (source == null) {
                source = files.stream().filter(f -> f.getFileName().toString().equals(baseName(name))).findFirst().orElse(null);
            }
            if (source == null) {
                continue;
            }
            try (InputStream in = repository.getResourceAsStream(deployment.getId(), name)) {
                if (in == null) {
                    problems.add("RepositoryService.getResourceAsStream returned null for deployed resource '" + name + "'");
                } else if (!Arrays.equals(in.readAllBytes(), Files.readAllBytes(source))) {
                    problems.add("Deployed resource '" + name + "' differs from " + source);
                }
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        // 4. process definition keys
        TreeSet<String> expectedKeys = new TreeSet<>();
        for (Path file : files) {
            String fileName = file.getFileName().toString();
            if (fileName.endsWith(".bpmn20.xml") || fileName.endsWith(".bpmn")) {
                try {
                    expectedKeys.addAll(executableProcessIds(file));
                } catch (Exception e) {
                    problems.add("Cannot read process ids from " + file + ": " + e);
                }
            }
        }
        List<ProcessDefinition> definitions = context.definitions();
        TreeSet<String> actualKeys = new TreeSet<>();
        definitions.forEach(d -> actualKeys.add(d.getKey()));
        if (!expectedKeys.equals(actualKeys)) {
            TreeSet<String> missing = new TreeSet<>(expectedKeys);
            missing.removeAll(actualKeys);
            TreeSet<String> unexpected = new TreeSet<>(actualKeys);
            unexpected.removeAll(expectedKeys);
            problems.add("Process definition keys: expected " + expectedKeys + " (the executable processes of the BPMN files) but the deployment has "
                    + actualKeys + "; missing " + missing + ", unexpected " + unexpected);
        }
        if (definitions.size() != actualKeys.size()) {
            problems.add("The deployment has " + definitions.size() + " process definitions for " + actualKeys.size() + " keys");
        }
        definitions.stream().filter(d -> d.getVersion() != 1)
                .forEach(d -> problems.add("Process definition " + d.getKey() + " has version " + d.getVersion() + " in a fresh database"));
        return problems;
    }

    /**
     * Validates every BPMN file of the project the way the engine does at deployment: the file is parsed fresh and the
     * model validated before the parse handlers rewrite it (the cached model of a deployed definition has, for example,
     * message ids replaced by names and would fail validation). The expected async-executor warnings become notes,
     * everything else a problem.
     */
    static ValidationOutcome validate(ProjectContext context) {
        RepositoryService repository = context.bean(RepositoryService.class);
        List<String> notes = new ArrayList<>();
        List<String> problems = new ArrayList<>();
        TreeSet<String> seen = new TreeSet<>();
        for (Path file : ProjectContext.deployableFiles(context.project().processesDir())) {
            String fileName = file.getFileName().toString();
            if (!fileName.endsWith(".bpmn20.xml") && !fileName.endsWith(".bpmn")) {
                continue;
            }
            BpmnModel model = new BpmnXMLConverter().convertToBpmnModel((InputStreamProvider) () -> {
                try {
                    return Files.newInputStream(file);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            }, true, false);
            java.util.Set<String> dataElementIds = dataElementIds(file);
            for (ValidationError error : repository.validateProcess(model)) {
                String line = fileName + ": " + error.getKey() + " at " + error.getProcessDefinitionId() + "/" + error.getActivityId() + " (line "
                        + error.getXmlLineNumber() + "): " + error.getDefaultDescription();
                if (!seen.add(line)) {
                    continue;
                }
                if (error.isWarning() && EXPECTED_ASYNC_WARNING_KEYS.contains(error.getKey())) {
                    notes.add("expected validator warning (the async executor is off): " + line);
                } else if (error.isWarning() && NOT_EXECUTABLE_WARNING_KEY.equals(error.getKey())) {
                    notes.add("expected validator warning (the process is deliberately not executable): " + line);
                } else if (error.isWarning() && EXPECTED_DATA_DI_WARNING_KEYS.contains(error.getKey()) && namesDataElement(error, dataElementIds)) {
                    notes.add("expected validator warning (the engine keeps no model element for data references and data associations): " + line);
                } else {
                    problems.add((error.isWarning() ? "validator warning: " : "validator error: ") + line);
                }
            }
        }
        return new ValidationOutcome(problems, notes);
    }

    /** The ids of the data object references, data store references and data associations in a BPMN file. */
    private static java.util.Set<String> dataElementIds(Path file) {
        java.util.Set<String> ids = new TreeSet<>();
        try {
            java.util.regex.Matcher matcher = DATA_ELEMENT_ID.matcher(Files.readString(file));
            while (matcher.find()) {
                ids.add(matcher.group(1));
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return ids;
    }

    /** Whether a diagram interchange warning is about one of the elements ("could not find X" / "X does not reference a flow node"). */
    private static boolean namesDataElement(ValidationError error, java.util.Set<String> dataElementIds) {
        String description = String.valueOf(error.getDefaultDescription());
        return dataElementIds.stream().anyMatch(id -> description.endsWith("could not find " + id)
                || description.endsWith(": " + id + " does not reference a flow node"));
    }

    record ValidationOutcome(List<String> problems, List<String> notes) {
    }

    static String baseName(String resourceName) {
        int slash = Math.max(resourceName.lastIndexOf('/'), resourceName.lastIndexOf('\\'));
        return slash < 0 ? resourceName : resourceName.substring(slash + 1);
    }

    /** Ids of the {@code process} elements of a BPMN file that the engine deploys (isExecutable is not "false"). */
    static List<String> executableProcessIds(Path bpmnFile) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        Document document;
        try (InputStream in = Files.newInputStream(bpmnFile)) {
            document = factory.newDocumentBuilder().parse(in);
        }
        List<String> ids = new ArrayList<>();
        NodeList processes = document.getElementsByTagNameNS(BPMN_NAMESPACE, "process");
        for (int i = 0; i < processes.getLength(); i++) {
            Element process = (Element) processes.item(i);
            if (!"false".equals(process.getAttribute("isExecutable"))) {
                ids.add(process.getAttribute("id"));
            }
        }
        return ids;
    }
}
