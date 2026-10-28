package io.github.kleash.activiti.dmn.kie.e2e;

import java.nio.file.Path;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.github.kleash.activiti.dmn.e2e.E2eApplication;

/** The loan DRD of corpus C17 (PRIORITY, literal expression, UNIQUE sink) evaluated by KIE. */
@SpringBootTest(classes = E2eApplication.class, properties = "activiti.dmn.engine=kie")
class KieC17EndToEndTest extends AbstractKieCorpusTest {

    private static final Path PROJECT = corpus("C17-dmn-drd");

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
