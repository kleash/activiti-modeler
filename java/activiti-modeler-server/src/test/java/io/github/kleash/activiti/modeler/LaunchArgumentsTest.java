package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import io.github.kleash.activiti.modeler.launch.LaunchArguments;

class LaunchArgumentsTest {

    @Test
    void theShortOptionsBecomeTheSpringProperties() {
        LaunchArguments launch = LaunchArguments.translate(new String[] {"--workspace=/tmp/projects", "--port=9090", "--open", "--modeler.server.allow-shell-tasks=true"});

        assertThat(launch.springArguments()).containsExactly("--modeler.workspace.dir=/tmp/projects", "--server.port=9090",
                "--modeler.server.open-browser=true", "--modeler.server.allow-shell-tasks=true");
        assertThat(launch.helpRequested()).isFalse();
    }

    @Test
    void theValueMayBeTheNextArgument() {
        assertThat(LaunchArguments.translate(new String[] {"--workspace", "projects", "--port", "81"}).springArguments())
                .containsExactly("--modeler.workspace.dir=projects", "--server.port=81");
    }

    @Test
    void helpIsRecognisedAndOtherArgumentsPassThrough() {
        assertThat(LaunchArguments.translate(new String[] {"-h"}).helpRequested()).isTrue();
        assertThat(LaunchArguments.translate(new String[] {"--help"}).helpRequested()).isTrue();
        assertThat(LaunchArguments.translate(new String[] {"--spring.datasource.url=jdbc:h2:mem:x"}).springArguments()).containsExactly("--spring.datasource.url=jdbc:h2:mem:x");
        assertThat(LaunchArguments.USAGE).contains("--workspace=<folder>").contains("127.0.0.1");
    }

    @Test
    void noOpenAndNoWindowBecomeExplicitFalseProperties() {
        assertThat(LaunchArguments.translate(new String[] {"--no-open", "--no-window"}).springArguments())
                .containsExactly("--modeler.server.open-browser=false", "--modeler.server.status-window=false");
        assertThat(LaunchArguments.USAGE).contains("--no-open").contains("--no-window").contains("~/ActivitiModeler");
    }
}
