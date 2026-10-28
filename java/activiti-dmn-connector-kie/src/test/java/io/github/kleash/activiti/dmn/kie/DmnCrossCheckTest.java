package io.github.kleash.activiti.dmn.kie;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.dmn.DecisionEvaluation;
import io.github.kleash.activiti.dmn.DmnAggregation;
import io.github.kleash.activiti.dmn.DmnDeploymentResolver;
import io.github.kleash.activiti.dmn.DmnEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.DmnException;
import io.github.kleash.activiti.dmn.DmnModel;
import io.github.kleash.activiti.dmn.DmnResource;
import io.github.kleash.activiti.dmn.e2e.ScenarioFileRunner;
import io.github.kleash.activiti.dmn.testing.FolderRepository;

/**
 * The cross-check utility and its use on the corpus: every {@code decisions[]} entry of C16 and C17 is evaluated by
 * Operaton (with the PRIORITY / OUTPUT ORDER extension) and by KIE, and both must give the oracle's result rows and
 * matched rules.
 */
class DmnCrossCheckTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final DmnCrossCheck crossCheck = new DmnCrossCheck();

    private static Path corpus(String project) {
        return Path.of("..", "..", "corpus", project).toAbsolutePath().normalize();
    }

    @TestFactory
    Stream<DynamicTest> everyCorpusDecisionGivesTheOracleResultOnBothEngines() throws IOException {
        List<DynamicTest> tests = new ArrayList<>();
        for (String project : List.of("C16-dmn-hit-policies", "C17-dmn-drd")) {
            DmnDeploymentResolver resolver = new DmnDeploymentResolver(FolderRepository.of(corpus(project).resolve("seed/processes")), 32);
            try (Stream<Path> files = Files.list(corpus(project).resolve("scenarios"))) {
                for (Path file : files.filter(f -> f.toString().endsWith(".scenario.json")).sorted().toList()) {
                    for (JsonNode decision : MAPPER.readTree(Files.readString(file)).path("decisions")) {
                        tests.add(DynamicTest.dynamicTest(project + " " + decision.get("decision").asText() + " " + decision.get("inputs"),
                            () -> verify(resolver, decision)));
                    }
                }
            }
        }
        assertThat(tests).hasSizeGreaterThan(45);
        return tests.stream();
    }

    private void verify(DmnDeploymentResolver resolver, JsonNode decision) {
        DmnDeploymentResolver.Resolved resolved = resolver.resolve(FolderRepository.DEPLOYMENT_ID, decision.get("decision").asText());
        Map<String, Object> inputs = MAPPER.convertValue(decision.get("inputs"), new TypeReference<Map<String, Object>>() { });

        DmnCrossCheck.Result result = crossCheck.check(resolved.resource(), resolved.decision().id(), inputs).requireAgreement();

        for (DmnEvaluation evaluation : List.of(result.primary(), result.secondary())) {
            ScenarioFileRunner.assertSameJson("rows", decision.get("expect").get("result"), evaluation.rows());
            List<String> expectedRules = new ArrayList<>();
            decision.get("expect").get("matchedRules").forEach(n -> expectedRules.add(n.asText()));
            assertThat(evaluation.matchedRules()).containsExactlyElementsOf(expectedRules);
        }
    }

    @Test
    void agreementIsReportedWithBothResults() throws IOException {
        DmnResource drd = new DmnResource("loan-decision.dmn", Files.readString(corpus("C17-dmn-drd").resolve("seed/processes/loan-decision.dmn")));

        DmnCrossCheck.Result result = crossCheck.check(drd, null, Map.of("age", 19, "country", "US", "income", 5000, "amount", 25000));

        assertThat(result.agree()).isTrue();
        assertThat(result.differences()).isEmpty();
        assertThat(result.primaryEngine()).isEqualTo("operaton");
        assertThat(result.secondaryEngine()).isEqualTo("kie");
        assertThat(result.primary().rows()).containsExactly(Map.of("offer", "DECLINE"));
        assertThat(result.secondary().decisions()).extracting(DecisionEvaluation::decisionId).containsExactly("riskClass", "maxLoan", "loanOffer");
        assertThat(result.requireAgreement()).isSameAs(result);
    }

    @Test
    void aConstructOnlyKieSupportsIsReportedAsADifference() throws IOException {
        DmnResource pricing = new DmnResource("pricing.dmn", Files.readString(corpus("C17-dmn-drd-kie").resolve("seed/processes/pricing.dmn")));

        DmnCrossCheck.Result result = crossCheck.check(pricing, null, Map.of("basePrice", 200, "loyaltyYears", 5));

        assertThat(result.agree()).isFalse();
        assertThat(result.primary()).isNull();
        assertThat(result.secondary().rows()).containsExactly(Map.of("finalPrice", 180L));
        assertThat(result.differences()).anyMatch(d -> d.startsWith("operaton failed:") && d.contains("business knowledge model"));
        assertThatThrownBy(result::requireAgreement).isInstanceOf(DmnException.class).hasMessageContaining("disagree");
    }

    @Test
    void bothEnginesFailingIsAgreement() {
        DmnCrossCheck.Result result = crossCheck.check(new DmnResource("broken.dmn", "<definitions"), null, Map.of());

        assertThat(result.agree()).isTrue();
        assertThat(result.primary()).isNull();
        assertThat(result.secondary()).isNull();
    }

    /** A scripted engine for the comparison rules. */
    private static DmnEvaluator scripted(String name, List<Map<String, Object>> rows, List<String> matched) {
        return new DmnEvaluator() {
            @Override
            public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
                DecisionEvaluation decision = new DecisionEvaluation("d", "d", DmnModel.Kind.DECISION_TABLE, io.github.kleash.activiti.dmn.DmnHitPolicy.COLLECT,
                    DmnAggregation.NONE, true, "d", rows, matched);
                return new DmnEvaluation(decision, List.of(decision));
            }

            @Override
            public String engineName() {
                return name;
            }
        };
    }

    @Test
    void numbersAreComparedByValueRowsAndRulesByOrder() {
        DmnResource any = new DmnResource("x.dmn", "<x/>");

        assertThat(new DmnCrossCheck(scripted("a", List.of(Map.of("v", 2L)), List.of("r1", "r2")),
            scripted("b", List.of(Map.of("v", 2.0)), List.of("r1", "r2"))).check(any, null, Map.of()).agree()).isTrue();

        DmnCrossCheck.Result rows = new DmnCrossCheck(scripted("a", List.of(Map.of("v", 2L)), List.of("r1")),
            scripted("b", List.of(Map.of("v", 3L)), List.of("r1"))).check(any, null, Map.of());
        assertThat(rows.differences()).singleElement().asString().contains("rows differ");

        DmnCrossCheck.Result order = new DmnCrossCheck(scripted("a", List.of(), List.of("r1", "r2")),
            scripted("b", List.of(), List.of("r2", "r1"))).check(any, null, Map.of());
        assertThat(order.differences()).anyMatch(d -> d.contains("matched rules differ"));
        assertThat(order.agree()).isFalse();
    }
}
