package io.github.kleash.activiti.dmn.kie.e2e;

import java.nio.file.Path;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.github.kleash.activiti.dmn.e2e.E2eApplication;

/** Every hit policy and aggregator of corpus C16 through the decision task, evaluated by KIE. */
@SpringBootTest(classes = E2eApplication.class, properties = "activiti.dmn.engine=kie")
class KieC16EndToEndTest extends AbstractKieCorpusTest {

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
}
