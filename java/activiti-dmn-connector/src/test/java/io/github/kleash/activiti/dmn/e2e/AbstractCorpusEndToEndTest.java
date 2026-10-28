package io.github.kleash.activiti.dmn.e2e;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.engine.HistoryService;
import org.activiti.engine.RepositoryService;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.DynamicPropertyRegistry;

import io.github.kleash.activiti.dmn.DmnEvaluationService;

/**
 * Base class of the end-to-end tests that deploy one corpus project from the file system into embedded Activiti 9.0.0
 * (resource names are therefore absolute paths, like Spring auto-deployment in production) and run its scenario files.
 * Subclasses are {@code @SpringBootTest(classes = E2eApplication.class)} classes that register the project with
 * {@link #deploy(DynamicPropertyRegistry, Path)} from a {@code @DynamicPropertySource} method.
 */
public abstract class AbstractCorpusEndToEndTest {

    @Autowired protected ProcessRuntime processRuntime;
    @Autowired protected HistoryService historyService;
    @Autowired protected RepositoryService repositoryService;
    @Autowired protected SequenceFlowRecorder recorder;
    @Autowired protected DmnEvaluationService decisions;
    @Autowired protected UserDetailsService users;

    /**
     * @param name the corpus project folder name, for example {@code C16-dmn-hit-policies}
     * @return the absolute path of {@code <repo>/corpus/<name>}
     */
    public static Path corpus(String name) {
        return Path.of("..", "..", "corpus", name).toAbsolutePath().normalize();
    }

    /**
     * Points the engine's auto-deployment at the seed folder of a project.
     *
     * @param registry the dynamic property registry
     * @param project  the project folder
     */
    public static void deploy(DynamicPropertyRegistry registry, Path project) {
        registry.add("spring.activiti.process-definition-location-prefix", () -> "file:" + project.resolve("seed/processes") + "/");
    }

    /** @return the project folder this test deploys */
    protected abstract Path project();

    /** @return the number of {@code *.scenario.json} files the project is expected to have */
    protected abstract int expectedScenarioFiles();

    /** @return the id of the single deployment of the project */
    protected String deploymentId() {
        return repositoryService.createDeploymentQuery().singleResult().getId();
    }

    /**
     * Runs every scenario file of the project.
     *
     * @return one dynamic test per scenario and per direct decision evaluation
     * @throws IOException when the scenario folder cannot be listed
     */
    @TestFactory
    public Stream<DynamicTest> scenarios() throws IOException {
        ScenarioFileRunner runner = new ScenarioFileRunner(processRuntime, historyService, repositoryService, recorder, decisions, users);
        List<Path> files;
        try (Stream<Path> found = Files.list(project().resolve("scenarios"))) {
            files = found.filter(p -> p.getFileName().toString().endsWith(".scenario.json")).sorted().toList();
        }
        assertThat(files).hasSize(expectedScenarioFiles());
        return files.stream().flatMap(runner::tests);
    }
}
