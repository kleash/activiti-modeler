package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.activiti.engine.ActivitiException;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.impl.cfg.ProcessEngineConfigurationImpl;
import org.activiti.validation.ProcessValidatorImpl;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * Finding recorded in docs/user-guide/scenarios.md: with {@code spring.activiti.async-executor-activate=false} the Boot
 * starter replaces Activiti's process validator by one that holds only its async-property rules, so none of the standard
 * rules run and a model with an invalid service task type deploys silently. The runner restores them.
 */
class FullValidationTest {

    private static final String INVALID_MODEL = """
            <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn" targetNamespace="x">
              <process id="invalidType" isExecutable="true">
                <startEvent id="s"/>
                <sequenceFlow id="f1" sourceRef="s" targetRef="t"/>
                <serviceTask id="t" activiti:type="nonsense"/>
                <sequenceFlow id="f2" sourceRef="t" targetRef="e"/>
                <endEvent id="e"/>
              </process>
            </definitions>""";

    private ConfigurableApplicationContext start(String... extraArguments) {
        String[] base = {"--spring.datasource.url=jdbc:h2:mem:validation-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1",
                "--spring.activiti.check-process-definitions=false", "--spring.activiti.async-executor-activate=false"};
        String[] all = new String[base.length + extraArguments.length];
        System.arraycopy(base, 0, all, 0, base.length);
        System.arraycopy(extraArguments, 0, all, base.length, extraArguments.length);
        return new SpringApplicationBuilder(TestApplication.class).web(WebApplicationType.NONE).run(all);
    }

    @Test
    void standardValidationRunsEvenThoughTheAsyncExecutorIsOff() {
        try (ConfigurableApplicationContext context = start()) {
            RepositoryService repository = context.getBean(RepositoryService.class);
            assertThatThrownBy(() -> repository.createDeployment().addString("invalid.bpmn20.xml", INVALID_MODEL).deploy())
                    .isInstanceOf(ActivitiException.class)
                    .hasMessageContaining("SERVICE_TASK_INVALID_TYPE");
            assertThat(validatorSetNames(context)).contains("activiti-executable-process", "activiti-spring-boot-starter");
        }
    }

    @Test
    void withoutTheRestorationTheStarterLeavesOnlyItsOwnRulesAndTheInvalidModelDeploys() {
        try (ConfigurableApplicationContext context = start("--activiti.scenario.full-validation=false")) {
            RepositoryService repository = context.getBean(RepositoryService.class);
            repository.createDeployment().addString("invalid.bpmn20.xml", INVALID_MODEL).deploy();
            assertThat(validatorSetNames(context)).containsExactly("activiti-spring-boot-starter");
        }
    }

    private static java.util.List<String> validatorSetNames(ConfigurableApplicationContext context) {
        ProcessEngineConfigurationImpl configuration = (ProcessEngineConfigurationImpl) context.getBean(ProcessEngineConfiguration.class);
        return ((ProcessValidatorImpl) configuration.getProcessValidator()).getValidatorSets().stream().map(set -> set.getName()).toList();
    }
}
