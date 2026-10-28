package io.github.kleash.activiti.dmn.e2e;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.activiti.api.process.model.ProcessInstance;
import org.activiti.api.process.model.builders.ProcessPayloadBuilder;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.engine.HistoryService;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.history.HistoricActivityInstance;
import org.activiti.engine.history.HistoricVariableInstance;
import org.activiti.engine.impl.identity.Authentication;
import org.junit.jupiter.api.DynamicTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.dmn.DmnEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluationService;

/**
 * A deliberately small interpreter of the scenario format of docs/adr/0005-scenario-format.md, limited to what the
 * DMN corpus projects use: {@code start.process} with {@code user} and {@code variables}; {@code expect.state},
 * {@code endEvents}, {@code path.contains / notContains / order / sequenceFlows}, {@code variables},
 * {@code absentVariables}; and {@code decisions[]} with {@code result} and {@code matchedRules}. Anything else in a
 * scenario file makes the run fail, so the files cannot silently use features this interpreter does not check.
 *
 * <p>It was written to check the hand-written oracles in {@code corpus/C16-*} and {@code corpus/C17-*} against the real
 * engine before the full scenario runner existed. Since then the <b>verification harness runs those projects with the
 * real runner</b> (every step, path coverage, both deploy modes) and cross-checks every decision on the other DMN engine;
 * that is the authoritative corpus run. This interpreter stays as a connector-level regression test: it runs the same
 * files through plain {@code ProcessRuntime} calls (so the connector is tested without the runner in the way), and it
 * is what lets the KIE module run the whole corpus with KIE as the primary engine. The price is the tripwire above:
 * oracles of these projects can only use the features listed, or the scenario files must be split.
 */
public final class ScenarioFileRunner {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ProcessRuntime processRuntime;
    private final HistoryService historyService;
    private final RepositoryService repositoryService;
    private final SequenceFlowRecorder recorder;
    private final DmnEvaluationService decisions;
    private final UserDetailsService users;

    /**
     * Creates a runner.
     *
     * @param processRuntime    Activiti's process runtime API
     * @param historyService    history (must be at level full)
     * @param repositoryService repository service
     * @param recorder          the sequence flow recorder
     * @param decisions         the direct decision evaluation service
     * @param users             the identity store
     */
    public ScenarioFileRunner(ProcessRuntime processRuntime, HistoryService historyService,
                              RepositoryService repositoryService, SequenceFlowRecorder recorder,
                              DmnEvaluationService decisions, UserDetailsService users) {
        this.processRuntime = processRuntime;
        this.historyService = historyService;
        this.repositoryService = repositoryService;
        this.recorder = recorder;
        this.decisions = decisions;
        this.users = users;
    }

    /**
     * Turns a scenario file into one dynamic test per scenario and per direct decision evaluation.
     *
     * @param file a {@code *.scenario.json} file
     * @return the tests
     */
    public Stream<DynamicTest> tests(Path file) {
        JsonNode root = read(file);
        assertOnlyKeys(root, "$schema", "name", "users", "clock", "scenarios", "decisions");
        String prefix = root.path("name").asText(file.getFileName().toString());
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode scenario : root.path("scenarios")) {
            tests.add(DynamicTest.dynamicTest(prefix + ": " + scenario.path("name").asText(), () -> runScenario(scenario)));
        }
        int index = 0;
        for (JsonNode decision : root.path("decisions")) {
            int n = ++index;
            tests.add(DynamicTest.dynamicTest(prefix + ": decision " + decision.path("decision").asText() + " "
                + decision.path("inputs") + " (#" + n + ")", () -> runDecision(decision)));
        }
        assertThat(tests).as("scenario file " + file + " defines tests").isNotEmpty();
        return tests.stream();
    }

    private void runScenario(JsonNode scenario) {
        assertOnlyKeys(scenario, "name", "start", "steps", "expect");
        assertThat(scenario.path("steps").isMissingNode() || scenario.path("steps").isEmpty())
            .as("this interpreter runs scenarios without steps").isTrue();
        JsonNode start = scenario.path("start");
        assertOnlyKeys(start, "process", "user", "variables", "businessKey");
        String user = start.path("user").asText("alice");
        UserDetails details = users.loadUserByUsername(user);
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(details, details.getPassword(), details.getAuthorities()));
        Authentication.setAuthenticatedUserId(user);
        ProcessInstance instance;
        try {
            Map<String, Object> variables = start.has("variables")
                ? MAPPER.convertValue(start.get("variables"), new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() { })
                : Map.of();
            instance = processRuntime.start(ProcessPayloadBuilder.start()
                .withProcessDefinitionKey(start.path("process").asText()).withVariables(variables).build());
        } finally {
            SecurityContextHolder.clearContext();
            Authentication.setAuthenticatedUserId(null);
        }
        check(instance.getId(), scenario.path("expect"));
    }

    private void check(String instanceId, JsonNode expect) {
        assertOnlyKeys(expect, "state", "endEvents", "path", "variables", "absentVariables");
        List<HistoricActivityInstance> activities = historyService.createHistoricActivityInstanceQuery()
            .processInstanceId(instanceId).list();
        Map<String, Object> variables = new HashMap<>();
        for (HistoricVariableInstance variable : historyService.createHistoricVariableInstanceQuery().processInstanceId(instanceId).list()) {
            variables.put(variable.getVariableName(), variable.getValue());
        }

        if (expect.has("state")) {
            assertThat(expect.get("state").asText()).isEqualTo("COMPLETED");
            assertThat(historyService.createHistoricProcessInstanceQuery().processInstanceId(instanceId).finished().count())
                .as("process instance finished").isEqualTo(1);
        }
        if (expect.has("endEvents")) {
            List<String> ends = activities.stream().filter(a -> "endEvent".equals(a.getActivityType()))
                .map(HistoricActivityInstance::getActivityId).toList();
            assertThat(ends).as("end events reached").containsExactlyInAnyOrderElementsOf(strings(expect.get("endEvents")));
        }
        if (expect.has("path")) {
            checkPath(instanceId, expect.get("path"), activities.stream().map(HistoricActivityInstance::getActivityId).toList());
        }
        if (expect.has("variables")) {
            Iterator<Map.Entry<String, JsonNode>> fields = expect.get("variables").fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                assertThat(variables).as("variable " + field.getKey()).containsKey(field.getKey());
                assertSameJson("variable " + field.getKey(), field.getValue(), variables.get(field.getKey()));
            }
        }
        if (expect.has("absentVariables")) {
            for (String name : strings(expect.get("absentVariables"))) {
                assertThat(variables).as("variable " + name + " must be absent").doesNotContainKey(name);
            }
        }
    }

    private void checkPath(String instanceId, JsonNode path, List<String> visited) {
        assertOnlyKeys(path, "contains", "notContains", "order", "sequenceFlows");
        List<SequenceFlowRecorder.Flow> flows = recorder.flowsOf(instanceId);
        List<String> visitOrder = new ArrayList<>();
        if (!flows.isEmpty()) {
            visitOrder.add(flows.get(0).sourceActivityId());
        }
        flows.forEach(f -> visitOrder.add(f.targetActivityId()));
        if (path.has("contains")) {
            assertThat(visited).as("activities visited").containsAll(strings(path.get("contains")));
        }
        if (path.has("notContains")) {
            assertThat(visited).as("activities not visited").doesNotContainAnyElementsOf(strings(path.get("notContains")));
        }
        if (path.has("order")) {
            for (JsonNode pair : path.get("order")) {
                String before = pair.get(0).asText();
                String after = pair.get(1).asText();
                assertThat(visitOrder).as("activity order " + before + " -> " + after).contains(before, after);
                assertThat(visitOrder.indexOf(before)).as(before + " before " + after).isLessThan(visitOrder.lastIndexOf(after));
            }
        }
        if (path.has("sequenceFlows")) {
            assertThat(flows.stream().map(SequenceFlowRecorder.Flow::flowId).toList())
                .as("sequence flows taken").containsAll(strings(path.get("sequenceFlows")));
        }
    }

    private void runDecision(JsonNode decision) {
        assertOnlyKeys(decision, "decision", "inputs", "expect");
        String deploymentId = repositoryService.createDeploymentQuery().singleResult().getId();
        Map<String, Object> inputs = MAPPER.convertValue(decision.get("inputs"),
            new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() { });
        DmnEvaluation evaluation = decisions.evaluateInDeployment(deploymentId, decision.get("decision").asText(), inputs);
        JsonNode expect = decision.get("expect");
        assertOnlyKeys(expect, "result", "matchedRules");
        assertSameJson("result rows of " + decision.get("decision").asText(), expect.get("result"), evaluation.rows());
        assertThat(evaluation.matchedRules()).as("matched rules").containsExactlyElementsOf(strings(expect.get("matchedRules")));
    }

    private static void assertOnlyKeys(JsonNode node, String... allowed) {
        List<String> allowedKeys = List.of(allowed);
        node.fieldNames().forEachRemaining(name -> {
            if (!allowedKeys.contains(name)) {
                fail("Scenario key '" + name + "' is not interpreted by the DMN end-to-end tests (allowed here: " + allowedKeys + ")");
            }
        });
    }

    private static List<String> strings(JsonNode array) {
        List<String> values = new ArrayList<>();
        array.forEach(n -> values.add(n.asText()));
        return values;
    }

    private static JsonNode read(Path file) {
        try {
            return MAPPER.readTree(Files.readString(file));
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + file, e);
        }
    }

    /** Compares an expected JSON literal with an actual value, comparing numbers numerically. */
    public static void assertSameJson(String what, JsonNode expected, Object actual) {
        JsonNode actualNode = actual instanceof JsonNode node ? node : MAPPER.valueToTree(actual);
        assertThat(describe(actualNode)).as(what).isEqualTo(describe(expected));
    }

    /**
     * A canonical text of a JSON value in which numbers are compared by value and object fields are sorted; two values
     * are the same when their descriptions are equal.
     *
     * @param node a JSON value
     * @return the canonical description
     */
    public static String describe(JsonNode node) {
        if (node.isNumber()) {
            return new BigDecimal(node.asText()).stripTrailingZeros().toPlainString();
        }
        if (node.isArray()) {
            List<String> items = new ArrayList<>();
            node.forEach(n -> items.add(describe(n)));
            return items.toString();
        }
        if (node.isObject()) {
            List<String> items = new ArrayList<>();
            List<String> names = new ArrayList<>();
            node.fieldNames().forEachRemaining(names::add);
            java.util.Collections.sort(names);
            names.forEach(name -> items.add(name + "=" + describe(node.get(name))));
            return "{" + String.join(",", items) + "}";
        }
        return node.toString();
    }
}
