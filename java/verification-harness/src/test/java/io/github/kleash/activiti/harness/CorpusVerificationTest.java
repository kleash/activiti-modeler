package io.github.kleash.activiti.harness;

import static org.junit.jupiter.api.DynamicContainer.dynamicContainer;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.TestFactory;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;
import io.github.kleash.activiti.harness.project.RepoLayout;

/**
 * The headline test: every corpus project - seeds at {@code corpus/<id>/seed}, projects exported by the modeler into
 * {@code java/verification-harness/target/corpus/<id>}, projects built through its UI in {@code target/corpus-ui/<id>} - or the
 * folder given with {@code -Dcorpus.dir} is deployed and run, in its own Spring context and H2 database, once through Spring
 * auto-deployment and once through a {@code DeploymentBuilder}. Every scenario, every decision case, the deployment assertions,
 * {@code model-expect.json} and path coverage are separate dynamic tests.
 *
 * <p>System properties: {@code corpus.dir} (run only this folder), {@code harness.projects} (comma separated id
 * prefixes), {@code harness.deploy.modes} ({@code auto}, {@code programmatic} or both, default both),
 * {@code harness.generated.dir}, {@code repo.root}.
 */
class CorpusVerificationTest {

    private static final DynamicChecks CHECKS = new DynamicChecks();

    @TestFactory
    Stream<DynamicNode> corpus() {
        List<Project> projects = ProjectDiscovery.filter(discover(), System.getProperty("harness.projects"));
        List<DeployMode> modes = modes();
        if (projects.isEmpty()) {
            return Stream.of(dynamicTest("at least one corpus project is found", () -> {
                throw new AssertionError("No corpus project found (seeds in " + RepoLayout.corpus() + "/<id>/seed, generated projects in "
                        + RepoLayout.generated() + ", or -Dcorpus.dir). A harness that runs nothing proves nothing.");
            }));
        }
        return projects.stream().map(project -> dynamicContainer(project.id() + " [" + project.origin().name().toLowerCase() + "]",
                modes.stream().map(mode -> dynamicContainer(mode.label(), CHECKS.checks(project, mode)))));
    }

    private static List<Project> discover() {
        String directory = System.getProperty("corpus.dir");
        if (directory != null && !directory.isBlank()) {
            return ProjectDiscovery.directory(Path.of(directory));
        }
        List<Project> projects = new ArrayList<>(ProjectDiscovery.seeds(RepoLayout.corpus()));
        projects.addAll(ProjectDiscovery.generated(RepoLayout.generated(), RepoLayout.corpus()));
        projects.addAll(ProjectDiscovery.ui(RepoLayout.ui(), RepoLayout.corpus()));
        return projects;
    }

    @AfterAll
    static void summary() {
        System.out.println(CHECKS.summary("Corpus verification summary"));
    }

    private static List<DeployMode> modes() {
        String configured = System.getProperty("harness.deploy.modes", "auto,programmatic");
        List<DeployMode> modes = new ArrayList<>();
        for (String mode : configured.split("\\s*,\\s*")) {
            switch (mode) {
                case "auto" -> modes.add(DeployMode.AUTO_DEPLOY);
                case "programmatic" -> modes.add(DeployMode.PROGRAMMATIC);
                case "both" -> modes.addAll(List.of(DeployMode.AUTO_DEPLOY, DeployMode.PROGRAMMATIC));
                default -> throw new IllegalArgumentException("harness.deploy.modes: unknown mode '" + mode + "' (auto, programmatic or both)");
            }
        }
        return modes;
    }
}