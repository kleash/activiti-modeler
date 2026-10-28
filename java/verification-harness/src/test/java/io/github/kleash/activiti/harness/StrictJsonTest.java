package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.DynamicContainer.dynamicContainer;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.activiti.core.common.model.connector.ConnectorDefinition;
import org.activiti.spring.process.model.ProcessExtensionModel;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;

import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;
import io.github.kleash.activiti.harness.project.RepoLayout;

/**
 * The JSON files of a project are read by the Activiti runtime with the host's {@code ObjectMapper}. Spring Boot's mapper ignores
 * unknown properties, but a host without it (and Activiti's own plain mapper) fails on the first field the Java classes do not
 * have; a lenient mapper in the harness would hide that. So every {@code processes/*-extensions.json} is read into
 * {@link ProcessExtensionModel} and every {@code connectors/*.json} into {@link ConnectorDefinition} with a <b>strict</b> mapper
 * ({@code FAIL_ON_UNKNOWN_PROPERTIES}, plus the case-insensitive enums that {@code ProcessExtensionResourceReader} turns on), one
 * dynamic test per file, for the seeds and for the projects the modeler exported (docs/engine-findings.md, ADR 0003). The negative
 * corpus N01 is left out on purpose: its files are broken by design.
 *
 * <p>It catches, for example, an APA-style top-level {@code name} / {@code type} in an extensions file, and a template
 * {@code version} or an Alfresco {@code config} in a connector file: Activiti's plain mapper fails on both.
 */
class StrictJsonTest {

    /** The runtime's reading of the extensions file ({@code ProcessExtensionResourceReader}), without the leniency of Spring Boot. */
    static ObjectMapper strict() {
        return new ObjectMapper()
                .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .enable(MapperFeature.ACCEPT_CASE_INSENSITIVE_ENUMS);
    }

    @TestFactory
    Stream<DynamicNode> everyJsonFileOfEveryProjectIsReadByTheRuntimeClasses() {
        List<Project> projects = projects();
        List<DynamicNode> nodes = new ArrayList<>();
        int files = 0;
        for (Project project : projects) {
            List<DynamicNode> tests = new ArrayList<>();
            for (Path file : jsonFiles(project.processesDir(), "-extensions.json")) {
                tests.add(dynamicTest("processes/" + file.getFileName() + " -> ProcessExtensionModel", () -> read(file, ProcessExtensionModel.class)));
            }
            if (project.connectorsDir() != null) {
                for (Path file : jsonFiles(project.connectorsDir(), ".json")) {
                    tests.add(dynamicTest("connectors/" + file.getFileName() + " -> ConnectorDefinition", () -> read(file, ConnectorDefinition.class)));
                }
            }
            files += tests.size();
            if (!tests.isEmpty()) {
                nodes.add(dynamicContainer(project.id() + " [" + project.origin().name().toLowerCase() + "]", tests));
            }
        }
        int found = files;
        nodes.add(dynamicTest("at least one extensions file and one connector file are checked", () -> assertThat(found).as("JSON files checked in " + projects).isGreaterThan(1)));
        return nodes.stream();
    }

    private static void read(Path file, Class<?> type) {
        try {
            Object model = strict().readValue(Files.readAllBytes(file), type);
            assertThat(model).as(file.toString()).isNotNull();
        } catch (IOException e) {
            throw new AssertionError(file + " is not read by " + type.getSimpleName() + " with a strict ObjectMapper: " + e.getMessage(), e);
        }
    }

    // ---- the check itself must be able to fail --------------------------------------------------------------------------------------

    @Test
    void theStrictMapperRefusesFieldsTheRuntimeModelDoesNotKnow() {
        // APA-style top level name / type in an extensions file
        assertThatThrownBy(() -> strict().readValue("{\"id\":\"x\",\"name\":\"n\",\"type\":\"t\",\"extensions\":{}}", ProcessExtensionModel.class))
                .isInstanceOf(UnrecognizedPropertyException.class).hasMessageContaining("name");
        // the template version and the Alfresco config in a connector file
        assertThatThrownBy(() -> strict().readValue("{\"id\":\"c\",\"name\":\"c\",\"version\":\"2\",\"actions\":{}}", ConnectorDefinition.class))
                .isInstanceOf(UnrecognizedPropertyException.class).hasMessageContaining("version");
        assertThatThrownBy(() -> strict().readValue("{\"id\":\"c\",\"name\":\"c\",\"actions\":{\"A\":{\"id\":\"A\",\"inputs\":[{\"id\":\"i\",\"default\":1}]}}}", ConnectorDefinition.class))
                .isInstanceOf(UnrecognizedPropertyException.class).hasMessageContaining("default");
    }

    @Test
    void theStrictMapperReadsEveryFieldOfTheRuntimeClasses() throws IOException {
        ConnectorDefinition definition = strict().readValue("""
                {"id":"c","name":"c","description":"d","actions":{"A":{"id":"A","name":"a","description":"x",
                  "inputs":[{"id":"i","name":"i","description":"d","type":"string","required":true,"display":true,"displayName":"I","analytics":false,"ephemeral":true}],
                  "outputs":[]}}}""", ConnectorDefinition.class);
        assertThat(definition.getActions().get("A").getInputs().get(0).getDisplayName()).isEqualTo("I");
        ProcessExtensionModel extensions = strict().readValue("""
                {"id":"p-extensions","extensions":{"p":{"properties":{"v":{"id":"v","name":"v","type":"string","required":false,"value":"x"}},
                 "mappings":{"t":{"mappingType":"map_all","inputs":{"a":{"type":"variable","value":"b"}},"outputs":{},"ephemeral":false}},
                 "constants":{"t":{"k":{"value":1}}}}}}""", ProcessExtensionModel.class);
        assertThat(extensions.getAllExtensions()).containsKey("p");
    }

    // ---- discovery -------------------------------------------------------------------------------------------------------------------

    private static List<Project> projects() {
        String directory = System.getProperty("corpus.dir");
        if (directory != null && !directory.isBlank()) {
            return ProjectDiscovery.directory(Path.of(directory));
        }
        List<Project> projects = new ArrayList<>(ProjectDiscovery.seeds(RepoLayout.corpus()));
        projects.addAll(ProjectDiscovery.generated(RepoLayout.generated(), RepoLayout.corpus()));
        projects.addAll(ProjectDiscovery.ui(RepoLayout.ui(), RepoLayout.corpus()));
        return projects.stream().filter(p -> !p.id().startsWith("N01")).toList();
    }

    private static List<Path> jsonFiles(Path dir, String suffix) {
        if (dir == null || !Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> list = Files.list(dir)) {
            return list.filter(p -> p.getFileName().toString().endsWith(suffix)).sorted().toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
