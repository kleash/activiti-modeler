package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import io.github.kleash.activiti.modeler.launch.LaunchEnvironment;
import io.github.kleash.activiti.modeler.launch.StartupDefaults;

/** The defaults of a start without arguments (ADR 0008). Every test uses a fake home: nothing here touches the real home folder. */
class StartupDefaultsTest {

    @TempDir Path home;

    private StartupDefaults resolve(Map<String, String> properties, Map<String, String> variables, boolean headless, String... arguments) {
        return resolveWithPort(8080, properties, variables, headless, arguments);
    }

    private StartupDefaults resolveWithPort(int port, Map<String, String> properties, Map<String, String> variables, boolean headless, String... arguments) {
        return StartupDefaults.resolve(arguments, LaunchEnvironment.of(properties, variables, home), headless, preferred -> port);
    }

    @Test
    void theDefaultWorkspaceIsInTheHomeFolderAndIsCreatedOnFirstStart() {
        assertThat(home.resolve("ActivitiModeler")).doesNotExist();

        StartupDefaults defaults = resolve(Map.of(), Map.of(), true);

        Path workspace = home.resolve("ActivitiModeler").resolve("workspace");
        assertThat(defaults.properties()).containsEntry("modeler.workspace.dir", workspace.toString());
        assertThat(workspace).isDirectory();
        assertThat(defaults.home()).isEqualTo(home.resolve("ActivitiModeler"));
    }

    @Test
    void anExistingWorkspaceIsLeftAlone() throws Exception {
        Path workspace = Files.createDirectories(home.resolve("ActivitiModeler").resolve("workspace").resolve("my-project"));
        Files.writeString(workspace.resolve("a.bpmn"), "<x/>");

        resolve(Map.of(), Map.of(), true);

        assertThat(workspace.resolve("a.bpmn")).hasContent("<x/>");
    }

    @Test
    void theHomeFolderCanBeMovedWithASystemPropertyOrAVariable() {
        Path elsewhere = home.resolve("elsewhere");

        StartupDefaults byProperty = resolve(Map.of("modeler.home", elsewhere.toString()), Map.of(), true);
        assertThat(byProperty.properties()).containsEntry("modeler.workspace.dir", elsewhere.resolve("workspace").toString());
        assertThat(elsewhere.resolve("workspace")).isDirectory();
        assertThat(home.resolve("ActivitiModeler")).doesNotExist();

        Path viaVariable = home.resolve("via-variable");
        StartupDefaults byVariable = resolve(Map.of(), Map.of("MODELER_HOME", viaVariable.toString()), true);
        assertThat(byVariable.properties()).containsEntry("modeler.workspace.dir", viaVariable.resolve("workspace").toString());
    }

    @Test
    void anExplicitWorkspaceWinsAndNothingIsCreatedInTheHomeFolder() {
        String[] argument = {"--modeler.workspace.dir=/somewhere/else"};
        assertThat(resolve(Map.of(), Map.of(), true, argument).properties()).doesNotContainKey("modeler.workspace.dir");
        assertThat(resolve(Map.of("modeler.workspace.dir", "/x"), Map.of(), true).properties()).doesNotContainKey("modeler.workspace.dir");
        assertThat(resolve(Map.of(), Map.of("MODELER_WORKSPACE_DIR", "/x"), true).properties()).doesNotContainKey("modeler.workspace.dir");
        assertThat(home.resolve("ActivitiModeler").resolve("workspace")).doesNotExist();
    }

    @Test
    void thePortIs8080WhenFree() {
        StartupDefaults defaults = resolve(Map.of(), Map.of(), true);

        assertThat(defaults.properties()).containsEntry("server.port", 8080);
        assertThat(defaults.notes()).isEmpty();
    }

    @Test
    void aTakenPortFallsBackToAFreeOneAndSaysSo() {
        StartupDefaults defaults = resolveWithPort(51234, Map.of(), Map.of(), true);

        assertThat(defaults.properties()).containsEntry("server.port", 51234);
        assertThat(defaults.notes()).singleElement().asString().contains("8080").contains("51234");
    }

    @Test
    void aRealTakenPortFallsBackThroughTheDefaultChooser() throws Exception {
        try (var taken = new java.net.ServerSocket(0)) {
            // the production chooser, asked for the port that is taken now
            int chosen = io.github.kleash.activiti.modeler.launch.PortSelection.choose(taken.getLocalPort());
            assertThat(chosen).isNotEqualTo(taken.getLocalPort()).isPositive();
        }
    }

    @Test
    void anExplicitPortIsNotTouched() {
        assertThat(resolve(Map.of(), Map.of(), true, "--server.port=0").properties()).doesNotContainKey("server.port");
        assertThat(resolve(Map.of(), Map.of("SERVER_PORT", "9000"), true).properties()).doesNotContainKey("server.port");
        assertThat(resolve(Map.of("server.port", "9000"), Map.of(), true).properties()).doesNotContainKey("server.port");
    }

    @Test
    void withADisplayTheBrowserOpensAndTheWindowShows() {
        StartupDefaults defaults = resolve(Map.of(), Map.of(), false);

        assertThat(defaults.properties()).containsEntry("modeler.server.open-browser", true);
        assertThat(defaults.statusWindow()).isTrue();
    }

    @Test
    void headlessNeitherOpensABrowserNorShowsAWindow() {
        StartupDefaults defaults = resolve(Map.of(), Map.of(), true);

        assertThat(defaults.properties()).containsEntry("modeler.server.open-browser", false);
        assertThat(defaults.statusWindow()).isFalse();
    }

    @Test
    void noOpenAndNoWindowAreHonoured() {
        StartupDefaults defaults = resolve(Map.of(), Map.of(), false, "--modeler.server.open-browser=false", "--modeler.server.status-window=false");

        assertThat(defaults.properties()).doesNotContainKey("modeler.server.open-browser");
        assertThat(defaults.statusWindow()).isFalse();
        assertThat(resolve(Map.of(), Map.of("MODELER_SERVER_STATUS_WINDOW", "false"), false).statusWindow()).isFalse();
    }

    @Test
    void aWindowCannotBeForcedWithoutADisplay() {
        assertThat(resolve(Map.of(), Map.of(), true, "--modeler.server.status-window=true").statusWindow()).isFalse();
    }

    @Test
    void logsAlsoGoToTheHomeFolder() {
        StartupDefaults defaults = resolve(Map.of(), Map.of(), true);

        Path logs = home.resolve("ActivitiModeler").resolve("logs");
        assertThat(defaults.properties()).containsEntry("logging.file.name", logs.resolve("activiti-modeler.log").toString())
                .containsKey("logging.logback.rollingpolicy.max-history");
        assertThat(logs).isDirectory();
        assertThat(resolve(Map.of(), Map.of(), true, "--logging.file.name=/tmp/x.log").properties()).doesNotContainKey("logging.file.name");
    }

    @Test
    void theContainerProfileGetsNoInteractiveDefaults() {
        for (StartupDefaults defaults : new StartupDefaults[] {
                resolve(Map.of(), Map.of("SPRING_PROFILES_ACTIVE", "container"), false),
                resolve(Map.of(), Map.of(), false, "--spring.profiles.active=container")}) {
            assertThat(defaults.properties()).doesNotContainKeys("modeler.workspace.dir", "logging.file.name")
                    .containsEntry("modeler.server.open-browser", false);
            assertThat(defaults.statusWindow()).isFalse();
        }
        assertThat(home.resolve("ActivitiModeler")).doesNotExist();
    }
}
