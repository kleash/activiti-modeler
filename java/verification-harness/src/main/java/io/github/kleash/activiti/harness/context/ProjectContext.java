package io.github.kleash.activiti.harness.context;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.Deployment;
import org.activiti.engine.repository.DeploymentBuilder;
import org.activiti.engine.repository.ProcessDefinition;
import org.springframework.boot.Banner;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;

/**
 * One project's own Spring application context with its own in-memory H2 database (unique name), the mandatory
 * engine settings of ADR 0005 (docs/adr/0005-scenario-format.md), the async executor off, and the project's models
 * deployed either by Spring auto-deployment or programmatically.
 */
public final class ProjectContext implements AutoCloseable {

    /** System property: comma separated extra configuration classes added to every project context. */
    public static final String EXTRA_CONFIG_PROPERTY = "harness.extra-config";

    private final Project project;
    private final DeployMode mode;
    private final ConfigurableApplicationContext spring;
    private final Deployment deployment;

    private ProjectContext(Project project, DeployMode mode, ConfigurableApplicationContext spring, Deployment deployment) {
        this.project = project;
        this.mode = mode;
        this.spring = spring;
        this.deployment = deployment;
    }

    /** Starts the context and deploys the project. The caller must {@link #close()} it. */
    public static ProjectContext start(Project project, DeployMode mode) {
        String database = "jdbc:h2:mem:" + project.id().replaceAll("[^A-Za-z0-9]", "_") + "_" + mode.name() + "_" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1";
        Map<String, String> properties = new LinkedHashMap<>();
        properties.put("spring.application.name", "verify-" + project.id());
        properties.put("spring.datasource.url", database);
        properties.put("spring.datasource.username", "sa");
        properties.put("spring.datasource.password", "");
        properties.put("spring.jmx.enabled", "false");
        // mandatory engine settings (ADR 0005); the async executor is off so that scenarios drive jobs themselves
        properties.put("spring.activiti.history-level", "full");
        properties.put("spring.activiti.db-history-used", "true");
        properties.put("spring.activiti.deployment-mode", "default");
        properties.put("spring.activiti.async-executor-activate", "false");
        properties.put("spring.activiti.process-definition-location-suffixes", "**.bpmn20.xml,**.bpmn,**.dmn");
        // the async-executor-off warnings are reported by the harness' own validation check instead
        properties.put("logging.level.org.activiti.engine.impl.bpmn.parser.BpmnParse", "ERROR");
        if (mode == DeployMode.AUTO_DEPLOY) {
            properties.put("spring.activiti.process-definition-location-prefix", directoryUrl(project.processesDir()));
        } else {
            properties.put("spring.activiti.check-process-definitions", "false");
        }
        if (project.connectorsDir() != null) {
            properties.put("activiti.connectors.dir", directoryUrl(project.connectorsDir()));
        }
        // the project's own hand-written properties (harness.properties), e.g. activiti.dmn.engine=kie
        properties.putAll(HarnessProperties.load(project.harnessProperties()));
        List<String> args = properties.entrySet().stream().map(e -> "--" + e.getKey() + "=" + e.getValue()).toList();

        SpringApplicationBuilder builder = new SpringApplicationBuilder(ProjectApplication.class)
                .web(WebApplicationType.NONE)
                .bannerMode(Banner.Mode.OFF)
                .logStartupInfo(false);
        String extra = System.getProperty(EXTRA_CONFIG_PROPERTY);
        if (extra != null && !extra.isBlank()) {
            for (String className : extra.split("\\s*,\\s*")) {
                try {
                    builder.sources(Class.forName(className));
                } catch (ClassNotFoundException e) {
                    throw new IllegalStateException("-D" + EXTRA_CONFIG_PROPERTY + " names a class that is not on the classpath: " + className, e);
                }
            }
        }
        ConfigurableApplicationContext spring = builder.run(args.toArray(String[]::new));
        try {
            Deployment deployment = mode == DeployMode.PROGRAMMATIC ? deployProgrammatically(project, spring.getBean(RepositoryService.class)) : null;
            return new ProjectContext(project, mode, spring, deployment);
        } catch (RuntimeException e) {
            spring.close();
            throw e;
        }
    }

    private static String directoryUrl(Path dir) {
        String url = dir.toAbsolutePath().normalize().toUri().toString();
        return url.endsWith("/") ? url : url + "/";
    }

    // ---- programmatic deployment -------------------------------------------------------------------------------------

    private static Deployment deployProgrammatically(Project project, RepositoryService repository) {
        List<Path> files = deployableFiles(project.processesDir());
        if (files.isEmpty()) {
            throw new IllegalStateException("No deployable files (*.bpmn20.xml, *.bpmn, *.dmn, *-extensions.json) in " + project.processesDir());
        }
        DeploymentBuilder builder = repository.createDeployment().name("SpringAutoDeployment");
        for (Path file : files) {
            String resourceName = project.processesDir().relativize(file).toString().replace('\\', '/');
            try {
                builder.addInputStream(resourceName, Files.newInputStream(file));
            } catch (IOException e) {
                throw new UncheckedIOException("Cannot read " + file, e);
            }
        }
        return builder.deploy();
    }

    /** The files under {@code processesDir} the engine deploys: BPMN, DMN and extensions JSON, sorted. */
    public static List<Path> deployableFiles(Path processesDir) {
        try (Stream<Path> walk = Files.walk(processesDir)) {
            return walk.filter(Files::isRegularFile)
                    .filter(p -> ProjectDiscovery.DEPLOYED_SUFFIXES.stream().anyMatch(s -> p.getFileName().toString().endsWith(s)))
                    .sorted(Comparator.comparing(Path::toString))
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // ---- access ---------------------------------------------------------------------------------------------------------

    public Project project() {
        return project;
    }

    public DeployMode mode() {
        return mode;
    }

    public ConfigurableApplicationContext spring() {
        return spring;
    }

    public <T> T bean(Class<T> type) {
        return spring.getBean(type);
    }

    /**
     * The project's deployment: the one Spring auto-deployment created, or the programmatic one.
     *
     * @throws IllegalStateException when there is none, or more than one (the default deployment mode makes exactly one)
     */
    public Deployment deployment() {
        if (deployment != null) {
            return deployment;
        }
        List<Deployment> all = bean(RepositoryService.class).createDeploymentQuery().list();
        if (all.size() != 1) {
            throw new IllegalStateException("Expected exactly one deployment (deployment-mode=default puts the whole project into one) but found "
                    + all.size() + ": " + all.stream().map(d -> d.getName() + "/" + d.getId()).toList());
        }
        return all.get(0);
    }

    /** All process definitions of the project's deployment (every version is 1 in a fresh database). */
    public List<ProcessDefinition> definitions() {
        return bean(RepositoryService.class).createProcessDefinitionQuery().deploymentId(deployment().getId()).orderByProcessDefinitionKey().asc().list();
    }

    @Override
    public void close() {
        spring.close();
    }
}
