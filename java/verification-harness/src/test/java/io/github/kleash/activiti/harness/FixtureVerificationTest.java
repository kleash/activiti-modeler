package io.github.kleash.activiti.harness;

import static org.junit.jupiter.api.DynamicContainer.dynamicContainer;

import java.util.stream.Stream;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;

/**
 * Runs the harness' own fixture projects ({@code src/test/resources/fixtures}) through the same machinery as the
 * corpus: they prove the harness and the corpus support beans (docs/corpus-support.md) work, independently of what is
 * in {@code corpus/}.
 */
class FixtureVerificationTest {

    private static final DynamicChecks CHECKS = new DynamicChecks();

    @TestFactory
    Stream<DynamicNode> fixtures() {
        return ProjectDiscovery.directory(TestProjects.fixtureDir("")).stream().map(project -> dynamicContainer(project.id(),
                Stream.of(DeployMode.values()).map(mode -> dynamicContainer(mode.label(), CHECKS.checks(project, mode)))));
    }

    @AfterAll
    static void summary() {
        System.out.println(CHECKS.summary("Fixture verification summary"));
    }
}
