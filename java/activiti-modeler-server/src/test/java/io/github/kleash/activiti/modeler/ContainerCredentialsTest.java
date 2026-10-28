package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import io.github.kleash.activiti.modeler.launch.ContainerCredentials;

/** In the Docker image the demo passwords are replaced; anywhere else nothing changes. */
class ContainerCredentialsTest {

    private MockEnvironment environment(String... profiles) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profiles);
        environment.setProperty("modeler.server.users.modeler.password", "modeler");
        environment.setProperty("modeler.server.users.alice.password", "alice");
        environment.setProperty("modeler.server.users.bob.password", "bob");
        return environment;
    }

    @Test
    void withoutTheContainerProfileTheDemoPasswordsStay() {
        MockEnvironment environment = environment();

        new ContainerCredentials().postProcessEnvironment(environment, null);

        assertThat(environment.getProperty("modeler.server.users.modeler.password")).isEqualTo("modeler");
        assertThat(environment.getProperty(ContainerCredentials.GENERATED_PROPERTY)).isNull();
    }

    @Test
    void inTheContainerARandomPasswordIsGeneratedForEveryUser() {
        MockEnvironment first = environment("container");
        MockEnvironment second = environment("container");

        new ContainerCredentials().postProcessEnvironment(first, null);
        new ContainerCredentials().postProcessEnvironment(second, null);

        String generated = first.getProperty(ContainerCredentials.GENERATED_PROPERTY);
        assertThat(generated).hasSize(20).matches("[A-Za-z0-9]+");
        assertThat(generated).isNotEqualTo(second.getProperty(ContainerCredentials.GENERATED_PROPERTY));
        for (String user : new String[] {"modeler", "alice", "bob"}) {
            assertThat(first.getProperty("modeler.server.users." + user + ".password")).isEqualTo("{noop}" + generated);
        }
    }

    @Test
    void modelerPasswordSetsThePasswordAndIsNotPrinted() {
        MockEnvironment environment = environment("container");
        environment.setProperty("MODELER_PASSWORD", "{my}pass word");

        new ContainerCredentials().postProcessEnvironment(environment, null);

        assertThat(environment.getProperty("modeler.server.users.modeler.password")).isEqualTo("{noop}{my}pass word");
        assertThat(environment.getProperty(ContainerCredentials.GENERATED_PROPERTY)).isNull();
    }
}
