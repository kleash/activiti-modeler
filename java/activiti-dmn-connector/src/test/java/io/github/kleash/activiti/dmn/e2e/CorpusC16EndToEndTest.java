package io.github.kleash.activiti.dmn.e2e;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Deploys the seed project {@code corpus/C16-dmn-hit-policies} (one DMN per hit policy and aggregator, three
 * processes) into embedded Activiti 9.0.0 on the default Operaton engine and runs its hand-written scenario files.
 * Proves that the corpus oracles hold on the real engine.
 */
@SpringBootTest(classes = E2eApplication.class)
class CorpusC16EndToEndTest extends AbstractCorpusEndToEndTest {

    private static final Path PROJECT = corpus("C16-dmn-hit-policies");

    @DynamicPropertySource
    static void deployProject(DynamicPropertyRegistry registry) {
        deploy(registry, PROJECT);
    }

    @Override
    protected Path project() {
        return PROJECT;
    }

    @Override
    protected int expectedScenarioFiles() {
        return 3;
    }

    @Test
    void deploymentHoldsBpmnExtensionsAndEveryDmnWithAbsolutePaths() {
        List<String> resources = repositoryService.getDeploymentResourceNames(deploymentId());

        assertThat(resources).filteredOn(n -> n.endsWith(".dmn")).hasSize(13)
            .allSatisfy(name -> assertThat(Path.of(name).isAbsolute()).as(name + " is an absolute path").isTrue());
        assertThat(resources).filteredOn(n -> n.endsWith("-extensions.json")).hasSize(3);
        assertThat(resources).filteredOn(n -> n.endsWith(".bpmn20.xml")).hasSize(3);
        assertThat(repositoryService.createProcessDefinitionQuery().list()).extracting(d -> d.getKey())
            .containsExactlyInAnyOrder("hitPolicies", "noMatchRouting", "mapAllOutputs");
    }
}
