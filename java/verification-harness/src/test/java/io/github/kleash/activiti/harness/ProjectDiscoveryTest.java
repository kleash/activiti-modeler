package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.Project.Origin;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;

class ProjectDiscoveryTest {

    @TempDir Path root;

    private Path file(String relative) throws IOException {
        Path p = root.resolve(relative);
        Files.createDirectories(p.getParent());
        return Files.writeString(p, "{}");
    }

    @Test
    void seedProjectsHaveTheirOraclesNextToTheSeedFolder() throws IOException {
        file("corpus/C04-gateways/seed/processes/gateways.bpmn20.xml");
        file("corpus/C04-gateways/seed/connectors/crm.json");
        file("corpus/C04-gateways/scenarios/b.scenario.json");
        file("corpus/C04-gateways/scenarios/a.scenario.json");
        file("corpus/C04-gateways/scenarios/coverage-exemptions.json");
        file("corpus/C04-gateways/scenarios/notes.txt");
        file("corpus/C04-gateways/model-expect.json");
        file("corpus/C99-no-seed/README.md");
        file("corpus/C10-sub/seed/processes/sub.bpmn20.xml");

        List<Project> seeds = ProjectDiscovery.seeds(root.resolve("corpus"));

        assertThat(seeds).extracting(Project::id).containsExactly("C04-gateways", "C10-sub");
        Project c04 = seeds.get(0);
        assertThat(c04.origin()).isEqualTo(Origin.SEED);
        assertThat(c04.processesDir()).isEqualTo(root.resolve("corpus/C04-gateways/seed/processes"));
        assertThat(c04.connectorsDir()).isEqualTo(root.resolve("corpus/C04-gateways/seed/connectors"));
        assertThat(c04.scenarioFiles()).extracting(p -> p.getFileName().toString()).containsExactly("a.scenario.json", "b.scenario.json");
        assertThat(c04.modelExpect()).isEqualTo(root.resolve("corpus/C04-gateways/model-expect.json"));
        assertThat(c04.exemptions()).isEqualTo(root.resolve("corpus/C04-gateways/scenarios/coverage-exemptions.json"));
        assertThat(seeds.get(1).scenarioFiles()).isEmpty();
        assertThat(seeds.get(1).modelExpect()).isNull();
        assertThat(seeds.get(1).exemptions()).isNull();
        assertThat(seeds.get(1).connectorsDir()).isNull();
    }

    @Test
    void generatedProjectsUseTheOraclesOfTheCorpusFolderWithTheSameId() throws IOException {
        file("gen/C04-gateways/processes/gateways.bpmn20.xml");
        file("gen/C04-gateways/project.json");
        file("gen/not-a-project/readme.txt");
        file("corpus/C04-gateways/scenarios/g.scenario.json");
        file("corpus/C04-gateways/model-expect.json");

        List<Project> generated = ProjectDiscovery.generated(root.resolve("gen"), root.resolve("corpus"));

        assertThat(generated).singleElement().satisfies(p -> {
            assertThat(p.id()).isEqualTo("C04-gateways");
            assertThat(p.origin()).isEqualTo(Origin.GENERATED);
            assertThat(p.processesDir()).isEqualTo(root.resolve("gen/C04-gateways/processes"));
            assertThat(p.scenarioFiles()).containsExactly(root.resolve("corpus/C04-gateways/scenarios/g.scenario.json"));
            assertThat(p.modelExpect()).isEqualTo(root.resolve("corpus/C04-gateways/model-expect.json"));
        });
    }

    @Test
    void projectsBuiltThroughTheUiAreATypeOfTheirOwnWithTheSameOracles() throws IOException {
        file("ui/C04-gateways/processes/gateways.bpmn20.xml");
        file("corpus/C04-gateways/scenarios/g.scenario.json");

        assertThat(ProjectDiscovery.ui(root.resolve("ui"), root.resolve("corpus"))).singleElement().satisfies(p -> {
            assertThat(p.id()).isEqualTo("C04-gateways");
            assertThat(p.origin()).isEqualTo(Origin.UI);
            assertThat(p.processesDir()).isEqualTo(root.resolve("ui/C04-gateways/processes"));
            assertThat(p.scenarioFiles()).containsExactly(root.resolve("corpus/C04-gateways/scenarios/g.scenario.json"));
        });
        assertThat(ProjectDiscovery.ui(root.resolve("nowhere"), root.resolve("corpus"))).isEmpty();
    }

    @Test
    void missingFoldersGiveNoProjects() {
        assertThat(ProjectDiscovery.seeds(root.resolve("nowhere"))).isEmpty();
        assertThat(ProjectDiscovery.generated(root.resolve("nowhere"), root.resolve("corpus"))).isEmpty();
    }

    @Test
    void aDirectoryWithProcessesIsOneProjectWithItsOwnOracles() throws IOException {
        file("mine/processes/a.bpmn20.xml");
        file("mine/scenarios/a.scenario.json");
        file("mine/model-expect.json");
        List<Project> projects = ProjectDiscovery.directory(root.resolve("mine"));
        assertThat(projects).singleElement().satisfies(p -> {
            assertThat(p.id()).isEqualTo("mine");
            assertThat(p.origin()).isEqualTo(Origin.DIRECTORY);
            assertThat(p.scenarioFiles()).hasSize(1);
            assertThat(p.modelExpect()).isNotNull();
        });
    }

    @Test
    void modelExpectMayAlsoLiveInTheScenariosFolder() throws IOException {
        file("mine/processes/a.bpmn20.xml");
        file("mine/scenarios/model-expect.json");
        assertThat(ProjectDiscovery.directory(root.resolve("mine")).get(0).modelExpect()).isEqualTo(root.resolve("mine/scenarios/model-expect.json"));
    }

    @Test
    void aDirectoryOfProjectsYieldsOneProjectPerSubFolder() throws IOException {
        file("many/one/processes/a.bpmn20.xml");
        file("many/two/processes/b.bpmn20.xml");
        file("many/three/docs/readme.md");
        assertThat(ProjectDiscovery.directory(root.resolve("many"))).extracting(Project::id).containsExactly("one", "two");
    }

    @Test
    void aSeedProjectOrACorpusRootCanBeVerifiedAsADirectory() throws IOException {
        file("corpus/C01-a/seed/processes/a.bpmn20.xml");
        file("corpus/C01-a/scenarios/a.scenario.json");
        file("corpus/C02-b/seed/processes/b.bpmn20.xml");
        assertThat(ProjectDiscovery.directory(root.resolve("corpus"))).extracting(Project::id).containsExactly("C01-a", "C02-b");
        assertThat(ProjectDiscovery.directory(root.resolve("corpus")).get(0).origin()).isEqualTo(Origin.SEED);
        assertThat(ProjectDiscovery.directory(root.resolve("corpus/C01-a"))).singleElement().satisfies(p -> {
            assertThat(p.id()).isEqualTo("C01-a");
            assertThat(p.origin()).isEqualTo(Origin.SEED);
            assertThat(p.scenarioFiles()).hasSize(1);
        });
    }

    @Test
    void aDirectoryWithoutProcessesIsRejectedWithAnExplanation() throws IOException {
        file("empty/readme.md");
        assertThatThrownBy(() -> ProjectDiscovery.directory(root.resolve("empty")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("has no processes/ folder");
        assertThatThrownBy(() -> ProjectDiscovery.directory(root.resolve("missing")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("is not a directory");
    }

    @Test
    void filterKeepsProjectsWhoseIdStartsWithOneOfThePrefixes() throws IOException {
        file("corpus/C01-user-tasks/seed/processes/a.bpmn20.xml");
        file("corpus/C04-gateways/seed/processes/a.bpmn20.xml");
        file("corpus/C10-sub-processes/seed/processes/a.bpmn20.xml");
        List<Project> all = ProjectDiscovery.seeds(root.resolve("corpus"));
        assertThat(ProjectDiscovery.filter(all, null)).hasSize(3);
        assertThat(ProjectDiscovery.filter(all, " ")).hasSize(3);
        assertThat(ProjectDiscovery.filter(all, "C04")).extracting(Project::id).containsExactly("C04-gateways");
        assertThat(ProjectDiscovery.filter(all, "C01, C10")).extracting(Project::id).containsExactly("C01-user-tasks", "C10-sub-processes");
        assertThat(ProjectDiscovery.filter(all, "C9")).isEmpty();
    }
}
