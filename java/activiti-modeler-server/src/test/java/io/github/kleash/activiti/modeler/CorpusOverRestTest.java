package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DynamicContainer;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.springframework.boot.Banner;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import io.github.kleash.activiti.harness.context.HarnessProperties;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;
import io.github.kleash.activiti.harness.project.RepoLayout;
import io.github.kleash.activiti.harness.support.CorpusSupportConfiguration;

/**
 * The whole corpus a second time, through the modeler server: for every corpus project (the hand-written seeds and, when the
 * modeler has built them, the generated projects of {@code java/verification-harness/target/corpus}; N01 is not a project) every
 * scenario file is sent to {@code POST /api/dev/scenarios/run} of a real, running server over HTTP, with the <b>async executor on</b>
 * (the scenario runner then drives the engine in {@code EXECUTOR} mode). The verification harness runs the same scenarios in
 * {@code MANUAL} mode with the executor off (ADR 0005, "Job driving"); this test proves they also hold when the engine's
 * own job executor competes for the jobs, which is what a person who presses "Run scenario" in the modeler gets.
 *
 * <p>What is the same as in the harness: the scenario files, the project files (BPMN, extensions, DMN of {@code processes/}), the
 * corpus support library (delegates, listeners, connectors, GreenMail for C14, see docs/corpus-support.md) and the per-project
 * {@code harness.properties} (a project whose properties differ, such as C17-kie with {@code activiti.dmn.engine=kie} or C14 with its mail
 * server, gets a server of its own). What is not: the harness' {@code model-expect.json}, path-coverage and DMN cross-check
 * oracles stay with the harness (they read the engine model directly, the REST endpoint only reports the scenario run).
 *
 * <p>Servers are shared by the projects with equal properties, like a developer's server that runs many scenarios in turn; each run deploys
 * its files as a deployment of its own and removes everything it created. A summary per project is printed at the end and written to
 * {@code target/corpus-over-rest.txt}.
 */
class CorpusOverRestTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String AUTHORIZATION = "Basic " + Base64.getEncoder().encodeToString("modeler:modeler".getBytes(StandardCharsets.UTF_8));

    /** The servers, by the properties that distinguish them. Closed after the last test. */
    private static final Map<Map<String, String>, Server> SERVERS = new ConcurrentHashMap<>();
    /** project label -> [scenario files passed, scenario files total, scenarios passed, scenarios total, milliseconds] */
    private static final Map<String, long[]> SUMMARY = new java.util.concurrent.ConcurrentSkipListMap<>();

    /**
     * Scenarios whose oracle is a property of an engine whose async executor is OFF, and so cannot hold on the server (executor ON). They
     * are left out of the file that is sent (the verification harness, which runs with the executor off, still runs every one of them); the
     * test fails when an entry no longer matches a scenario, so the list cannot rot. Key: {@code <project>/<file>}, value: scenario name
     * to the reason.
     */
    private static final Map<String, Map<String, String>> EXECUTOR_OFF_ONLY = Map.of(
            "C07-signals/signal-async.scenario.json", Map.of(
                    "without executing the job nothing is delivered",
                    "asserts that the asynchronous signal job is still pending (expect.state ACTIVE, 'end' not visited) after the last step; the "
                            + "running async executor executes that job right after the commit, so whether the instance has ended by then is a race"),
            "C02-service-tasks/async-service-tasks.scenario.json", Map.of(
                    "each asynchronous service task runs only when its job is executed",
                    "asserts, between the asynchronous service tasks, which one is active and that its connector was not called yet; the running "
                            + "async executor runs the job of each task as soon as it exists, so the task is already done when the step looks"),
            "C10-sub-processes/async-sub-process.scenario.json", Map.of(
                    "the content of an async sub process runs only when its job is executed",
                    "asserts that the sub process is active and its content has not started before its job is executed; the running async "
                            + "executor executes the job right away"),
            "C19-retries-incidents/service-retries.scenario.json", Map.of(
                    "a task that does not fail: its job simply succeeds and the process completes",
                    "asserts that the asynchronous service task is active before its job is executed; the job succeeds, so the running async "
                            + "executor may finish the task and the process before the step looks. The "
                            + "scenarios of this file whose job fails stay active by design and run here"));

    private record Server(ConfigurableApplicationContext context, String baseUrl, HttpClient client) {
    }

    @TestFactory
    List<DynamicNode> everyCorpusScenarioPassesOnTheServerWithTheAsyncExecutorOn() {
        List<Project> projects = new ArrayList<>(ProjectDiscovery.seeds(RepoLayout.corpus()));
        projects.addAll(ProjectDiscovery.generated(RepoLayout.generated(), RepoLayout.corpus()));
        String only = System.getProperty("harness.projects");
        projects = ProjectDiscovery.filter(projects, only);
        assertThat(projects).as("corpus projects found under %s", RepoLayout.corpus()).isNotEmpty();

        List<DynamicNode> nodes = new ArrayList<>();
        for (Project project : projects) {
            List<DynamicNode> children = new ArrayList<>();
            List<Map<String, String>> files = deployableFiles(project);
            for (Path scenario : project.scenarioFiles()) {
                children.add(DynamicTest.dynamicTest(scenario.getFileName().toString(), () -> run(project, files, scenario)));
            }
            if (children.isEmpty()) {
                children.add(DynamicTest.dynamicTest("has scenario files", () -> assertThat(project.scenarioFiles()).as(project + " has scenarios").isNotEmpty()));
            }
            nodes.add(DynamicContainer.dynamicContainer(label(project), children));
        }
        return nodes;
    }

    @AfterAll
    static void report() throws IOException {
        StringBuilder out = new StringBuilder("Corpus through the modeler server (POST /api/dev/scenarios/run, async executor on)\n");
        long files = 0;
        long filesPassed = 0;
        long scenarios = 0;
        long scenariosPassed = 0;
        for (Map.Entry<String, long[]> entry : SUMMARY.entrySet()) {
            long[] s = entry.getValue();
            out.append(String.format("  %-34s files %2d/%-2d  scenarios %3d/%-3d  %6d ms%n", entry.getKey(), s[0], s[1], s[2], s[3], s[4]));
            filesPassed += s[0];
            files += s[1];
            scenariosPassed += s[2];
            scenarios += s[3];
        }
        out.append(String.format("  total: %d/%d scenario files, %d/%d scenarios passed%n", filesPassed, files, scenariosPassed, scenarios));
        EXECUTOR_OFF_ONLY.forEach((file, byName) -> byName.forEach((name, reason) -> out.append("  not run here (executor-off oracle): ").append(file).append(" / ").append(name).append("%n".formatted()).append("      ").append(reason).append('\n')));
        System.out.print(out);
        Path target = Path.of("target");
        if (Files.isDirectory(target)) {
            Files.writeString(target.resolve("corpus-over-rest.txt"), out.toString());
        }
        SERVERS.values().forEach(s -> s.context().close());
        SERVERS.clear();
    }

    private static String label(Project project) {
        return project.id() + (project.origin() == Project.Origin.GENERATED ? " (generated)" : "");
    }

    /** The BPMN, DMN and extensions files the engine deploys, named as the project layout does (ADR 0003). */
    private static List<Map<String, String>> deployableFiles(Project project) {
        List<Map<String, String>> files = new ArrayList<>();
        try (var list = Files.list(project.processesDir())) {
            for (Path path : list.sorted().toList()) {
                String name = path.getFileName().toString();
                if (ProjectDiscovery.DEPLOYED_SUFFIXES.stream().anyMatch(name::endsWith)) {
                    Map<String, String> file = new LinkedHashMap<>();
                    file.put("path", "processes/" + name);
                    file.put("content", Files.readString(path));
                    files.add(file);
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + project.processesDir(), e);
        }
        return files;
    }

    private void run(Project project, List<Map<String, String>> files, Path scenario) throws Exception {
        Server server = serverFor(project);
        ObjectNode parsed = (ObjectNode) MAPPER.readTree(Files.readString(scenario));
        Map<String, String> executorOff = EXECUTOR_OFF_ONLY.getOrDefault(project.id() + "/" + scenario.getFileName(), Map.of());
        if (!executorOff.isEmpty()) {
            ArrayNode all = (ArrayNode) parsed.path("scenarios");
            for (String name : executorOff.keySet()) {
                boolean removed = false;
                for (int i = all.size() - 1; i >= 0; i--) {
                    if (name.equals(all.get(i).path("name").asText())) {
                        all.remove(i);
                        removed = true;
                    }
                }
                assertThat(removed).as("the executor-off scenario '%s' is no longer in %s: update EXECUTOR_OFF_ONLY", name, scenario.getFileName()).isTrue();
            }
        }
        long scenarioCount = parsed.path("scenarios").size() + parsed.path("decisions").size();
        org.junit.jupiter.api.Assumptions.assumeTrue(scenarioCount > 0, () -> scenario.getFileName() + " has only scenarios with an executor-off oracle: " + executorOff.keySet());
        String body = MAPPER.writeValueAsString(Map.of("files", files, "scenario", parsed));
        long began = System.nanoTime();
        HttpResponse<String> response = server.client().send(HttpRequest.newBuilder(URI.create(server.baseUrl() + "/api/dev/scenarios/run"))
                .header("Authorization", AUTHORIZATION).header("Content-Type", "application/json").header("Accept", "application/json")
                .timeout(Duration.ofMinutes(5)).POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        long millis = (System.nanoTime() - began) / 1_000_000;
        JsonNode answer = response.body().isBlank() ? MAPPER.nullNode() : MAPPER.readTree(response.body());
        boolean passed = response.statusCode() == 200 && answer.path("passed").asBoolean();
        long[] summary = SUMMARY.computeIfAbsent(label(project), k -> new long[5]);
        synchronized (summary) {
            summary[1] += 1;
            summary[3] += scenarioCount;
            summary[4] += millis;
            if (passed) {
                summary[0] += 1;
                summary[2] += scenarioCount;
            }
        }
        assertThat(response.statusCode()).as("HTTP status of %s / %s: %s", project.id(), scenario.getFileName(), response.body()).isEqualTo(200);
        assertThat(passed).as("%s / %s%n%s", project.id(), scenario.getFileName(), answer.path("rendered").asText(response.body())).isTrue();
    }

    /** The server for a project: projects with the same harness.properties share one. */
    private Server serverFor(Project project) {
        Map<String, String> properties = new TreeMap<>(HarnessProperties.load(project.harnessProperties()));
        // a project with properties of its own gets its own server (C14's mail server keeps the mails of every run: the seed and the
        // generated project must not share it; the harness gives every project its own context as well)
        if (!properties.isEmpty()) {
            properties.put("corpus.rest.server-of", label(project));
        }
        return SERVERS.computeIfAbsent(properties, CorpusOverRestTest::start);
    }

    private static Server start(Map<String, String> projectProperties) {
        List<String> args = new ArrayList<>();
        Map<String, String> properties = new LinkedHashMap<>();
        properties.put("server.port", "0");
        properties.put("spring.datasource.url", "jdbc:h2:mem:corpus_over_rest_" + UUID.randomUUID().toString().replace('-', '_') + ";DB_CLOSE_DELAY=-1");
        // the async executor stays ON (application.properties of the server); that is the point of this test
        properties.put("spring.activiti.async-executor-activate", "true");
        // the harness' support library names the same connector beans as the server's samples (crm.LOOKUP, echo.EXECUTE, same behaviour)
        properties.put("spring.main.allow-bean-definition-overriding", "true");
        // C14 has shell tasks
        properties.put("modeler.server.allow-shell-tasks", "true");
        properties.put("logging.level.org.activiti.engine.impl.bpmn.parser.BpmnParse", "ERROR");
        // a project with its own mail server (C14, harness.greenmail=true) must not meet the server's
        if ("true".equals(projectProperties.get("harness.greenmail"))) {
            properties.put("modeler.server.mail.enabled", "false");
        } else {
            properties.put("modeler.server.mail.port", "0");
        }
        properties.putAll(projectProperties);
        properties.remove("corpus.rest.server-of");
        // -Dcorpus.rest.prop.<spring property>=<value> adds a property to every server (for example a logger level when a scenario is investigated)
        System.getProperties().stringPropertyNames().stream().filter(k -> k.startsWith("corpus.rest.prop."))
                .forEach(k -> properties.put(k.substring("corpus.rest.prop.".length()), System.getProperty(k)));
        properties.forEach((k, v) -> args.add("--" + k + "=" + v));
        ConfigurableApplicationContext context = new SpringApplicationBuilder(ModelerServerApplication.class, CorpusSupportConfiguration.class)
                .web(WebApplicationType.SERVLET).bannerMode(Banner.Mode.OFF).logStartupInfo(false)
                .run(args.toArray(String[]::new));
        String port = context.getEnvironment().getProperty("local.server.port");
        return new Server(context, "http://127.0.0.1:" + port, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build());
    }
}
