package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import org.activiti.engine.HistoryService;
import org.activiti.engine.ManagementService;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.history.HistoricActivityInstance;
import org.activiti.engine.impl.history.HistoryLevel;
import org.activiti.engine.repository.Deployment;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.boot.Banner;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.activiti.core.common.spring.identity.ExtendedInMemoryUserDetailsManager;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.context.ProjectApplication;
import io.github.kleash.activiti.harness.context.ProjectContext;
import io.github.kleash.activiti.harness.project.Project;

/**
 * The engine settings and the deployment behaviour that ADR 0003 and ADR 0005 rely on: the history tables exist and are filled,
 * {@code .dmn} files land in the same deployment and can be read back, resource names are absolute paths under Spring
 * auto-deployment, and the extensions file is found in both deploy modes. The history and the {@code .dmn} settings are also shown
 * to <em>fail</em> without them, so that neither can be dropped unnoticed.
 */
class HistoryAndDeploymentSettingsTest {

    private final Project mini = TestProjects.fixture("mini");

    /** Identity store for contexts that switch the scenario runner (and with it the default user store) off. */
    @Configuration(proxyBeanMethods = false)
    static class Users {
        @Bean
        ExtendedInMemoryUserDetailsManager users() {
            return new ExtendedInMemoryUserDetailsManager();
        }
    }

    /** A bare context with the given arguments; {@code activiti.scenario.enabled=false} lets it run with default settings. */
    private ConfigurableApplicationContext bare(String... args) {
        return new SpringApplicationBuilder(ProjectApplication.class, Users.class).web(WebApplicationType.NONE).bannerMode(Banner.Mode.OFF)
                .logStartupInfo(false).run(args);
    }

    private static String database() {
        return "--spring.datasource.url=jdbc:h2:mem:regression_" + UUID.randomUUID().toString().replace('-', '_') + ";DB_CLOSE_DELAY=-1";
    }

    private static String prefix(Project project) {
        return "--spring.activiti.process-definition-location-prefix=" + project.processesDir().toUri();
    }

    // ---- history ----------------------------------------------------------------------------------------------------------

    @ParameterizedTest
    @EnumSource(DeployMode.class)
    void historyTablesExistAndHistoricActivityInstancesAreProduced(DeployMode mode) {
        try (ProjectContext context = ProjectContext.start(mini, mode)) {
            ManagementService management = context.bean(ManagementService.class);
            assertThat(management.getTableCount()).containsKeys("ACT_HI_ACTINST", "ACT_HI_PROCINST", "ACT_HI_VARINST", "ACT_HI_DETAIL", "ACT_HI_TASKINST");

            ProcessEngineConfiguration configuration = context.bean(ProcessEngineConfiguration.class);
            assertThat(configuration.getHistoryLevel()).isEqualTo(HistoryLevel.FULL);
            assertThat(configuration.isDbHistoryUsed()).isTrue();

            String processInstanceId = context.bean(RuntimeService.class).startProcessInstanceByKey("mini").getId();
            List<HistoricActivityInstance> activities = context.bean(HistoryService.class).createHistoricActivityInstanceQuery()
                    .processInstanceId(processInstanceId).list();
            assertThat(activities).extracting(HistoricActivityInstance::getActivityId).containsExactlyInAnyOrder("start", "check");
            assertThat(context.bean(HistoryService.class).createHistoricProcessInstanceQuery().processInstanceId(processInstanceId).count()).isEqualTo(1);
        }
    }

    @Test
    void withTheDefaultSettingsThereIsNoHistoryTableAtAll() {
        try (ConfigurableApplicationContext context = bare(database(), "--activiti.scenario.enabled=false", "--spring.activiti.check-process-definitions=false")) {
            assertThat(context.getBean(ProcessEngineConfiguration.class).getHistoryLevel()).isEqualTo(HistoryLevel.NONE);
            assertThat(context.getBean(ManagementService.class).getTableCount().keySet()).noneMatch(name -> name.startsWith("ACT_HI_"));
        }
    }

    // ---- .dmn in the same deployment ------------------------------------------------------------------------------------------

    @Test
    void dmnFilesAreDeployedWithTheBpmnAndReadableThroughTheRepositoryService() throws IOException {
        try (ProjectContext context = ProjectContext.start(mini, DeployMode.AUTO_DEPLOY)) {
            RepositoryService repository = context.bean(RepositoryService.class);
            assertThat(repository.createDeploymentQuery().count()).describedAs("one deployment for the whole project").isEqualTo(1);
            Deployment deployment = context.deployment();

            List<String> names = repository.getDeploymentResourceNames(deployment.getId());
            assertThat(names).anyMatch(n -> n.endsWith("rules.dmn")).anyMatch(n -> n.endsWith("mini.bpmn20.xml")).anyMatch(n -> n.endsWith("mini-extensions.json"));

            String dmnResource = names.stream().filter(n -> n.endsWith("rules.dmn")).findFirst().orElseThrow();
            try (InputStream in = repository.getResourceAsStream(deployment.getId(), dmnResource)) {
                assertThat(in.readAllBytes()).isEqualTo(Files.readAllBytes(mini.processesDir().resolve("rules.dmn")));
            }
        }
    }

    @Test
    void withoutTheDmnSuffixTheDmnFileIsNotDeployed() {
        try (ConfigurableApplicationContext context = bare(database(), "--activiti.scenario.enabled=false", prefix(mini),
                "--spring.activiti.history-level=full", "--spring.activiti.db-history-used=true", "--spring.activiti.async-executor-activate=false",
                "--spring.activiti.process-definition-location-suffixes=**.bpmn20.xml,**.bpmn")) {
            RepositoryService repository = context.getBean(RepositoryService.class);
            Deployment deployment = repository.createDeploymentQuery().singleResult();
            List<String> names = repository.getDeploymentResourceNames(deployment.getId());
            assertThat(names).noneMatch(n -> n.endsWith(".dmn")).anyMatch(n -> n.endsWith("mini.bpmn20.xml")).anyMatch(n -> n.endsWith("mini-extensions.json"));
        }
    }

    // ---- resource names -----------------------------------------------------------------------------------------------------------

    @Test
    void autoDeploymentStoresAbsolutePathsAsResourceNames() {
        try (ProjectContext context = ProjectContext.start(mini, DeployMode.AUTO_DEPLOY)) {
            List<String> names = context.bean(RepositoryService.class).getDeploymentResourceNames(context.deployment().getId());
            assertThat(names).isNotEmpty().allSatisfy(name -> assertThat(Path.of(name)).isAbsolute());
            assertThat(names).contains(mini.processesDir().resolve("mini.bpmn20.xml").toFile().getAbsolutePath());
        }
    }

    @Test
    void programmaticDeploymentKeepsTheNamesItWasGiven() {
        try (ProjectContext context = ProjectContext.start(mini, DeployMode.PROGRAMMATIC)) {
            List<String> names = context.bean(RepositoryService.class).getDeploymentResourceNames(context.deployment().getId());
            assertThat(names).containsExactlyInAnyOrder("mini.bpmn20.xml", "mini-extensions.json", "rules.dmn");
        }
    }

    @Test
    void theExtensionsFileIsFoundInBothDeployModes() {
        for (DeployMode mode : DeployMode.values()) {
            try (ProjectContext context = ProjectContext.start(mini, mode)) {
                // The mapping for the user task only works when the extensions JSON was read from the deployment.
                RuntimeService runtime = context.bean(RuntimeService.class);
                String id = runtime.startProcessInstanceByKey("mini").getId();
                assertThat(runtime.getActiveActivityIds(id)).containsExactly("check");
            }
        }
    }
}
