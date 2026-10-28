package io.github.kleash.activiti.scenario.run;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

import io.github.kleash.activiti.scenario.jobs.JobDriver;
import io.github.kleash.activiti.scenario.jobs.ManualJobDriver;
import io.github.kleash.activiti.scenario.recording.RecordingConnector;
import io.github.kleash.activiti.scenario.testapp.TestApplication;
import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.core.common.spring.identity.ExtendedInMemoryUserDetailsManager;
import org.springframework.security.core.userdetails.UserDetailsService;

/** What a host application gets by adding the dependency. */
@SpringBootTest(classes = TestApplication.class)
class AutoConfigurationTest {

    @Autowired ApplicationContext context;
    @Autowired JobDriver driver;

    @Test
    void everyConnectorBeanIsWrappedByTheRecordingConnector() {
        assertThat(context.getBean("crm.LOOKUP", Connector.class)).isInstanceOf(RecordingConnector.class);
    }

    @Test
    void theJobDriverIsManualBecauseTheAsyncExecutorIsOff() {
        assertThat(driver).isInstanceOf(ManualJobDriver.class);
    }

    @Test
    void aUserDetailsManagerThatActivitiCanReadGroupsFromIsProvidedWhenTheHostHasNone() {
        assertThat(context.getBean(UserDetailsService.class)).isInstanceOf(ExtendedInMemoryUserDetailsManager.class);
    }

    @Test
    void runnerLoaderAndCheckerAreAvailable() {
        assertThat(context.getBeansOfType(io.github.kleash.activiti.scenario.run.ScenarioRunner.class)).hasSize(1);
        assertThat(context.getBeansOfType(io.github.kleash.activiti.scenario.load.ScenarioLoader.class)).hasSize(1);
        assertThat(context.getBeansOfType(io.github.kleash.activiti.scenario.modelexpect.ModelExpectChecker.class)).hasSize(1);
    }
}
