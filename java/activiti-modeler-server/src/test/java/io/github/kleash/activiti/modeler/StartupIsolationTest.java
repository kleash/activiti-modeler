package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.GraphicsEnvironment;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;

import io.github.kleash.activiti.modeler.launch.StartupDefaults;

/**
 * A test context is not a launch: it gets none of the interactive defaults of {@code main} (ADR 0008), so no test opens a browser or a
 * window or writes to the real home folder.
 */
class StartupIsolationTest extends AbstractServerTest {

    @Autowired Environment environment;
    @Autowired ModelerServerProperties properties;

    @Test
    void noBrowserAndNoWindow() {
        assertThat(properties.isOpenBrowser()).isFalse();
        assertThat(properties.isStatusWindow()).isFalse();
        assertThat(GraphicsEnvironment.isHeadless()).isTrue();
    }

    @Test
    void theWorkspaceIsTheTestsTemporaryFolderNotTheDefault() {
        assertThat(environment.getProperty("modeler.workspace.dir")).isEqualTo(WORKSPACE.toString());
        assertThat(Path.of(environment.getProperty("modeler.workspace.dir"))).startsWith(Path.of(System.getProperty("java.io.tmpdir")));
    }

    @Test
    void noLogFileIsConfigured() {
        assertThat(environment.getProperty("logging.file.name")).isNull();
    }

    @Test
    void theHomeFolderOfTheTestsIsInsideTarget() {
        // surefire sets -Dmodeler.home, so even a test that resolved the default would not reach ~/ActivitiModeler
        Path home = StartupDefaults.home(io.github.kleash.activiti.modeler.launch.LaunchEnvironment.system());
        assertThat(home.toString()).startsWith(Path.of("target").toAbsolutePath().normalize().toString());
    }
}
