package io.github.kleash.activiti.dmn.e2e;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.activiti.api.process.model.builders.ProcessPayloadBuilder;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.engine.HistoryService;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.history.HistoricVariableInstance;
import org.activiti.engine.impl.identity.Authentication;
import org.activiti.engine.repository.DeploymentBuilder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.github.kleash.activiti.dmn.DmnConnector;
import io.github.kleash.activiti.dmn.DmnDeploymentResolver;
import io.github.kleash.activiti.dmn.DmnFixtures;
import io.github.kleash.activiti.dmn.DmnResolutionException;

/**
 * End-to-end tests of the decision task in embedded Activiti 9.0.0: the connector bean, each form of decision
 * reference (resource base name, definitions name, decision id) with absolute resource names, ambiguity and not-found
 * errors, the rule that outputs reach the process only through output mappings, deployment-scoped resolution and
 * caching.
 */
@SpringBootTest(classes = E2eApplication.class)
class DmnConnectorEndToEndTest {

    private static final Path FIXTURES = Path.of("src", "test", "resources", "e2e-lookup").toAbsolutePath().normalize();

    private static final String BPMN = """
        <?xml version="1.0" encoding="UTF-8"?>
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://test/programmatic">
          <process id="%1$s" isExecutable="true">
            <startEvent id="start"/>
            <serviceTask id="decide" implementation="dmn-connector.EXECUTE_TABLE"/>
            <endEvent id="end"/>
            <sequenceFlow id="f1" sourceRef="start" targetRef="decide"/>
            <sequenceFlow id="f2" sourceRef="decide" targetRef="end"/>
          </process>
        </definitions>
        """;

    private static final String EXTENSIONS = """
        {"id":"%1$s-ext","extensions":{"%1$s":{
          "properties":{"p":{"id":"p","name":"same","type":"string"},"q":{"id":"q","name":"shared","type":"string"}},
          "mappings":{"decide":{"outputs":{"same":{"type":"variable","value":"same"},"shared":{"type":"variable","value":"shared"}}}},
          "constants":{"decide":{"_activiti_dmn_table_":{"value":"%2$s"}}}}}}
        """;

    @DynamicPropertySource
    static void deployFixtures(DynamicPropertyRegistry registry) {
        registry.add("spring.activiti.process-definition-location-prefix", () -> "file:" + FIXTURES.resolve("processes") + "/");
    }

    @Autowired private ProcessRuntime processRuntime;
    @Autowired private HistoryService historyService;
    @Autowired private RepositoryService repositoryService;
    @Autowired private UserDetailsService users;
    @Autowired private ApplicationContext context;
    @Autowired private DmnDeploymentResolver resolver;

    @BeforeEach
    void logIn() {
        UserDetails alice = users.loadUserByUsername("alice");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(alice, alice.getPassword(), alice.getAuthorities()));
        Authentication.setAuthenticatedUserId("alice");
    }

    @AfterEach
    void logOut() {
        SecurityContextHolder.clearContext();
        Authentication.setAuthenticatedUserId(null);
    }

    private Map<String, Object> run(String processKey, Map<String, Object> variables) {
        String id = processRuntime.start(ProcessPayloadBuilder.start().withProcessDefinitionKey(processKey).withVariables(variables).build()).getId();
        Map<String, Object> result = new HashMap<>();
        for (HistoricVariableInstance variable : historyService.createHistoricVariableInstanceQuery().processInstanceId(id).list()) {
            result.put(variable.getVariableName(), variable.getValue());
        }
        assertThat(historyService.createHistoricProcessInstanceQuery().processInstanceId(id).finished().count()).as("instance finished").isEqualTo(1);
        return result;
    }

    /** Deploys one process whose decision task references {@code reference}, together with the given DMN resources. */
    private void deployProcess(String processKey, String reference, Map<String, String> dmnResources) {
        DeploymentBuilder deployment = repositoryService.createDeployment().name("programmatic-" + processKey)
            .addString(processKey + ".bpmn20.xml", BPMN.formatted(processKey))
            .addString(processKey + "-extensions.json", EXTENSIONS.formatted(processKey, reference));
        dmnResources.forEach(deployment::addString);
        deployment.deploy();
    }

    @Test
    void connectorBeanIsRegisteredUnderTheImplementationName() {
        assertThat(DmnConnector.IMPLEMENTATION).isEqualTo("dmn-connector.EXECUTE_TABLE");
        assertThat(context.containsBean("dmn-connector.EXECUTE_TABLE")).isTrue();
        assertThat(context.getBean("dmn-connector.EXECUTE_TABLE", Connector.class)).isInstanceOf(DmnConnector.class);
    }

    @Test
    void deploymentContainsDmnAndExtensionsNextToTheBpmnWithAbsolutePaths() {
        String deployment = repositoryService.createDeploymentQuery().deploymentName("SpringAutoDeployment").singleResult().getId();

        List<String> names = repositoryService.getDeploymentResourceNames(deployment);
        assertThat(names).filteredOn(n -> n.endsWith(".dmn")).containsExactly(FIXTURES.resolve("processes/fees.dmn").toString());
        assertThat(names).filteredOn(n -> n.endsWith("lookupForms-extensions.json")).hasSize(1);
        assertThat(names).filteredOn(n -> n.endsWith("lookupForms.bpmn20.xml")).hasSize(1);
    }

    @Test
    void allThreeReferenceFormsResolveAgainstAbsoluteResourceNames() {
        Map<String, Object> variables = run("lookupForms", Map.of("n", 3));

        assertThat(variables).containsEntry("feeByFile", "low").containsEntry("feeByModelName", "low").containsEntry("feeById", "low");
        assertThat(run("lookupForms", Map.of("n", 30))).containsEntry("feeByFile", "high").containsEntry("feeById", "high");
    }

    @Test
    void unknownDecisionFailsTheStartAndRollsEverythingBack() {
        long before = historyService.createHistoricProcessInstanceQuery().processDefinitionKey("missingDecision").count();

        assertThatThrownBy(() -> run("missingDecision", Map.of("n", 1)))
            .hasStackTraceContaining(DmnResolutionException.class.getName())
            .hasStackTraceContaining("'doesNotExist' is neither a DMN resource name, a DMN definitions name nor a decision id")
            .hasStackTraceContaining("Decision task 'decide'");
        assertThat(historyService.createHistoricProcessInstanceQuery().processDefinitionKey("missingDecision").count())
            .as("a synchronous failure rolls the start back").isEqualTo(before);
    }

    @Test
    void ambiguousReferencesFailWithTheCandidates() {
        // Spring's `**.dmn` pattern does not descend into sub folders, so the ambiguity is built with programmatic deployments
        deployProcess("ambiguousFile", "dup", Map.of(
            "a/dup.dmn", DmnFixtures.literal("fromA", List.of(), "string", "\"A\""),
            "b/dup.dmn", DmnFixtures.literal("fromB", List.of(), "string", "\"B\"")));

        assertThatThrownBy(() -> run("ambiguousFile", Map.of()))
            .hasStackTraceContaining("'dup' is ambiguous").hasStackTraceContaining("resource base name")
            .hasStackTraceContaining("a/dup.dmn").hasStackTraceContaining("b/dup.dmn").hasStackTraceContaining("unique decision id");
    }

    @Test
    void aDecisionTaskWithoutTheTableConstantFails() {
        assertThatThrownBy(() -> run("noConstant", Map.of("n", 1)))
            .hasStackTraceContaining(DmnResolutionException.class.getName()).hasStackTraceContaining("_activiti_dmn_table_");
    }

    @Test
    void outputsReachTheProcessOnlyThroughOutputMappings() {
        // no mapping entry at all: the table is found through the constant, but nothing reaches the process
        Map<String, Object> noEntry = run("noMappingEntry", Map.of("n", 3));
        assertThat(noEntry).doesNotContainKeys("fee", "_activiti_dmn_matched_", "_activiti_dmn_matched_rules_");

        // inputs mapped, outputs not: still nothing reaches the process
        Map<String, Object> inputsOnly = run("inputsOnlyMapping", Map.of("n", 3));
        assertThat(inputsOnly).doesNotContainKeys("fee", "_activiti_dmn_matched_", "_activiti_dmn_matched_rules_");
    }

    @Test
    void undeclaredOutputTargetsAreSkippedByTheEngine() {
        Map<String, Object> variables = run("undeclaredTarget", Map.of("n", 3));

        assertThat(variables).containsEntry("fee", "low").doesNotContainKey("ghost");
    }

    @Test
    void secondRunServesTheDocumentFromTheCache() {
        run("lookupForms", Map.of("n", 1));
        long misses = resolver.cacheMisses();
        long hits = resolver.cacheHits();

        run("lookupForms", Map.of("n", 2));

        assertThat(resolver.cacheMisses()).as("no document is read or parsed again").isEqualTo(misses);
        assertThat(resolver.cacheHits()).isGreaterThan(hits);
    }

    @Test
    void definitionsNameBeatsDecisionIdWhenBothMatch() {
        // 'same' is the decision id in one.dmn and the definitions name of two.dmn; step 2 (definitions name) comes first
        String one = DmnFixtures.literal("same", List.of(), "string", "\"from decision id\"").replace("name=\"same\" namespace", "name=\"model one\" namespace");
        String two = DmnFixtures.literal("other", List.of(), "string", "\"from definitions name\"").replace("name=\"other\" namespace", "name=\"same\" namespace");
        deployProcess("nameBeatsId", "same", Map.of("one.dmn", one.replace("defs_same", "defs_one"), "two.dmn", two));

        // the sink of two.dmn is the decision 'other', which is published under its variable name 'other'
        assertThat(run("nameBeatsId", Map.of())).doesNotContainKey("same");
        assertThat(resolver.resolve(repositoryService.createDeploymentQuery().deploymentName("programmatic-nameBeatsId").singleResult().getId(), "same")
            .decision().id()).isEqualTo("other");
    }

    @Test
    void eachProcessDefinitionResolvesAgainstItsOwnDeployment() {
        for (String answer : List.of("A", "B")) {
            deployProcess("iso" + answer, "shared", Map.of("rules.dmn", DmnFixtures.literal("shared", List.of(), "string", "\"" + answer + "\"")));
        }

        assertThat(run("isoA", Map.of())).containsEntry("shared", "A");
        assertThat(run("isoB", Map.of())).containsEntry("shared", "B");
    }
}
