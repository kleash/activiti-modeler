package io.github.kleash.activiti.dmn;

import static io.github.kleash.activiti.dmn.DmnFixtures.decisionXml;
import static io.github.kleash.activiti.dmn.DmnFixtures.document;
import static io.github.kleash.activiti.dmn.DmnFixtures.rule;
import static io.github.kleash.activiti.dmn.DmnFixtures.singleTable;
import static io.github.kleash.activiti.dmn.DmnFixtures.tableXml;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.dmn.DmnFixtures.In;
import io.github.kleash.activiti.dmn.DmnFixtures.Out;

/** Behaviour that is specific to the Operaton evaluator (the shared contract is in {@link OperatonEvaluatorContractTest}). */
class OperatonDmnEvaluatorTest {

    private static final In N = new In("n", "number");
    private static final Out OUT = new Out("out", "string", null);

    private final OperatonDmnEvaluator evaluator = new OperatonDmnEvaluator();

    private static String corpus(String project, String file) throws IOException {
        return Files.readString(Path.of("..", "..", "corpus", project, "seed", "processes", file));
    }

    @Test
    void validateAcceptsADocumentTheEngineCanRunAndRefusesOthersWithoutEvaluating() throws IOException {
        evaluator.validate(new DmnResource("ok.dmn", singleTable("d", "UNIQUE", null, List.of(N), List.of(OUT),
            List.of(rule("r1", "<5", "\"small\""), rule("r2", ">=5", "\"big\"")))));
        evaluator.validate(new DmnResource("priority.dmn", corpus("C16-dmn-hit-policies", "priority-risk.dmn")));

        assertThatThrownBy(() -> evaluator.validate(new DmnResource("broken.dmn", "<definitions")))
            .isInstanceOf(DmnModelException.class);
        assertThatThrownBy(() -> evaluator.validate(new DmnResource("kie.dmn", corpus("C17-dmn-drd-kie", "pricing.dmn"))))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("business knowledge model");
        // a table with an unnamed output column cannot be run
        assertThatThrownBy(() -> evaluator.validate(new DmnResource("unnamed.dmn", singleTable("d", "UNIQUE", null, List.of(N),
            List.of(new Out("", "string", null)), List.of(rule("r1", "<5", "\"small\""))))))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("no name");
    }

    @Test
    void namesItself() {
        assertThat(evaluator.engineName()).isEqualTo("operaton");
    }

    @Test
    void reportsTheOriginalHitPolicyNotTheRewrittenOne() {
        String xml = singleTable("d", "PRIORITY", null, List.of(N), List.of(new Out("out", "string", "\"a\",\"b\"")),
            List.of(rule("r", "-", "\"a\"")));

        DecisionEvaluation decision = evaluator.evaluate(new DmnResource("t.dmn", xml), "d", Map.of("n", 1)).requested();

        assertThat(decision.hitPolicy()).isEqualTo(DmnHitPolicy.PRIORITY);
        assertThat(decision.multiResult()).isFalse();
        assertThat(decision.kind()).isEqualTo(DmnModel.Kind.DECISION_TABLE);
    }

    @Test
    void rejectsBusinessKnowledgeModelsWithAPointerToTheKieEngine() throws IOException {
        DmnResource pricing = new DmnResource("pricing.dmn", corpus("C17-dmn-drd-kie", "pricing.dmn"));

        assertThatThrownBy(() -> evaluator.evaluate(pricing, null, Map.of("basePrice", 200, "loyaltyYears", 5)))
            .isInstanceOf(DmnModelException.class)
            .hasMessageContaining("finalPrice").hasMessageContaining("business knowledge model")
            .hasMessageContaining("activiti.dmn.engine=kie");
    }

    @Test
    void rejectsBoxedExpressionsOtherThanTablesAndLiterals() {
        String xml = document("ctx", List.of(), "  <decision id=\"d\" name=\"d\"><variable id=\"v\" name=\"d\"/>"
            + "<context id=\"c\"><contextEntry><literalExpression><text>1</text></literalExpression></contextEntry></context></decision>\n");

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("ctx.dmn", xml), null, Map.of()))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("boxed expression 'context'").hasMessageContaining("activiti.dmn.engine=kie");
    }

    @Test
    void rejectsADecisionWithoutLogic() {
        String xml = document("none", List.of(), "  <decision id=\"d\" name=\"d\"><variable id=\"v\" name=\"d\"/></decision>\n");

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("none.dmn", xml), null, Map.of()))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("has no decision logic");
    }

    @Test
    void rejectsOutputColumnsWithoutAName() {
        String xml = document("noname", List.of(N), decisionXml("d", null, List.of(), List.of("n"),
            tableXml("d", "UNIQUE", null, List.of(N), List.of(new Out("", "string", null)), List.of(rule("r", "-", "\"a\"")))));

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("noname.dmn", xml), null, Map.of("n", 1)))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("has no name");
    }

    @Test
    void priorityNeedsOutputValues() {
        String xml = singleTable("d", "PRIORITY", null, List.of(N), List.of(OUT), List.of(rule("r", "-", "\"a\"")));

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("p.dmn", xml), null, Map.of("n", 1)))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("needs 'outputValues'");
    }

    @Test
    void anOutputOutsideOutputValuesFailsThePriorityDecision() {
        String xml = singleTable("d", "OUTPUT ORDER", null, List.of(N), List.of(new Out("out", "string", "\"a\",\"b\"")),
            List.of(rule("r1", "-", "\"a\""), rule("r2", "-", "\"c\"")));

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("p.dmn", xml), null, Map.of("n", 1)))
            .isInstanceOf(DmnException.class).hasMessageContaining("\"c\"").hasMessageContaining("not in the column's outputValues");
    }

    @Test
    void feelBreadthOnUnaryTests() {
        String xml = singleTable("d", "FIRST", null,
            List.of(N, new In("country", "string"), new In("vip", "boolean")), List.of(OUT),
            List.of(rule("range", List.of("[18..65]", "\"US\",\"CA\"", "-"), List.of("\"adult-na\"")),
                rule("not", List.of("> 65", "not(\"US\")", "true"), List.of("\"senior-vip\"")),
                rule("cmp", List.of("<= 5", "-", "-"), List.of("\"child\"")),
                rule("rest", List.of("-", "-", "-"), List.of("\"other\""))));
        DmnResource resource = new DmnResource("feel.dmn", xml);

        assertThat(evaluator.evaluate(resource, null, Map.of("n", 30, "country", "CA", "vip", false)).matchedRules()).containsExactly("range");
        assertThat(evaluator.evaluate(resource, null, Map.of("n", 70, "country", "DE", "vip", true)).matchedRules()).containsExactly("not");
        assertThat(evaluator.evaluate(resource, null, Map.of("n", 3, "country", "DE", "vip", true)).matchedRules()).containsExactly("cmp");
        assertThat(evaluator.evaluate(resource, null, Map.of("n", 70, "country", "US", "vip", true)).matchedRules()).containsExactly("rest");
    }

    @Test
    void jsonVariablesOfActivitiAreUsableInFeelExpressions() throws IOException {
        String xml = document("json", List.of(new In("person", "Any")), decisionXml("d", "string", List.of(), List.of("person"),
            tableXml("d", "UNIQUE", null, List.of(new In("person.age", "number")), List.of(OUT),
                List.of(rule("minor", "< 18", "\"minor\""), rule("adult", ">= 18", "\"adult\"")))));
        Object person = new ObjectMapper().readTree("{\"age\": 42}");

        DmnEvaluation evaluation = evaluator.evaluate(new DmnResource("json.dmn", xml), null, Map.of("person", person));

        assertThat(evaluation.rows()).containsExactly(Map.of("out", "adult"));
    }

    @Test
    void missingInputsBehaveLikeNullAndDoNotMatchComparisons() {
        String xml = singleTable("d", "UNIQUE", null, List.of(N), List.of(OUT), List.of(rule("pos", "> 0", "\"pos\"")));

        DmnEvaluation evaluation = evaluator.evaluate(new DmnResource("m.dmn", xml), null, Map.of());

        assertThat(evaluation.matched()).isFalse();
    }

    @Test
    void numbersComeBackAsLongOrDouble() {
        String xml = DmnFixtures.literal("d", List.of(N), "number", "n / 4");

        assertThat(evaluator.evaluate(new DmnResource("n.dmn", xml), null, Map.of("n", 10)).rows()).containsExactly(Map.of("d", 2.5));
        assertThat(evaluator.evaluate(new DmnResource("n.dmn", xml), null, Map.of("n", 8)).rows()).containsExactly(Map.of("d", 2L));
    }

    @Test
    void parsedDocumentsAreCachedByContentNotByName() {
        OperatonDmnEvaluator fresh = new OperatonDmnEvaluator(8);
        String xml = singleTable("d", "UNIQUE", null, List.of(N), List.of(OUT), List.of(rule("r", "-", "\"a\"")));

        fresh.evaluate(new DmnResource("first.dmn", xml), null, Map.of("n", 1));
        fresh.evaluate(new DmnResource("second.dmn", xml), null, Map.of("n", 2));
        assertThat(fresh.cachedDocuments()).isEqualTo(1);

        fresh.evaluate(new DmnResource("third.dmn", xml.replace("\"a\"", "\"b\"")), null, Map.of("n", 1));
        assertThat(fresh.cachedDocuments()).isEqualTo(2);
    }

    @Test
    void cacheIsBounded() {
        OperatonDmnEvaluator small = new OperatonDmnEvaluator(1);
        for (int i = 0; i < 3; i++) {
            String xml = singleTable("d", "UNIQUE", null, List.of(N), List.of(OUT), List.of(rule("r", "-", "\"v" + i + "\"")));
            assertThat(small.evaluate(new DmnResource("d.dmn", xml), null, Map.of("n", 1)).rows()).containsExactly(Map.of("out", "v" + i));
        }
        assertThat(small.cachedDocuments()).isEqualTo(1);
    }

    @Test
    void concurrentEvaluationsDoNotMixUpMatchedRules() throws Exception {
        String xml = singleTable("d", "PRIORITY", null, List.of(N), List.of(new Out("out", "string", "\"high\",\"mid\",\"low\"")),
            List.of(rule("lo", "> 0", "\"low\""), rule("mid", "> 10", "\"mid\""), rule("hi", "> 100", "\"high\"")));
        DmnResource resource = new DmnResource("c.dmn", xml);
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Callable<String>> jobs = new ArrayList<>();
            for (int i = 0; i < 400; i++) {
                int n = i % 3 == 0 ? 5 : i % 3 == 1 ? 50 : 500;
                String expected = n == 5 ? "lo" : n == 50 ? "mid" : "hi";
                jobs.add(() -> {
                    DmnEvaluation e = evaluator.evaluate(resource, null, Map.of("n", n));
                    return e.matchedRules().equals(List.of(expected)) ? "ok" : "wrong: " + n + " -> " + e.matchedRules();
                });
            }
            for (Future<String> result : pool.invokeAll(jobs)) {
                assertThat(result.get()).isEqualTo("ok");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void feelSyntaxErrorsAreReportedAsDmnExceptions() {
        String xml = DmnFixtures.literal("d", List.of(N), "number", "n +");

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("bad.dmn", xml), null, Map.of("n", 1)))
            .isInstanceOf(DmnException.class).hasMessageContaining("'d'");
    }

    @Test
    void ruleWithoutIdIsReportedUnderTheSynthesizedId() {
        String xml = document("x", List.of(N), decisionXml("d", null, List.of(), List.of("n"),
            "    <decisionTable id=\"t\" hitPolicy=\"UNIQUE\"><input id=\"i\"><inputExpression typeRef=\"number\"><text>n</text></inputExpression></input>"
                + "<output id=\"o\" name=\"out\" typeRef=\"string\"/><rule><inputEntry><text>&lt; 5</text></inputEntry><outputEntry><text>\"low\"</text></outputEntry></rule>"
                + "<rule id=\"named\"><inputEntry><text>&gt;= 5</text></inputEntry><outputEntry><text>\"high\"</text></outputEntry></rule></decisionTable>\n"));

        assertThat(evaluator.evaluate(new DmnResource("x.dmn", xml), null, Map.of("n", 1)).matchedRules()).containsExactly("d_rule1");
        assertThat(evaluator.evaluate(new DmnResource("x.dmn", xml), null, Map.of("n", 9)).matchedRules()).containsExactly("named");
    }

    @Test
    void evaluatesTheCorpusDrdChainWithPriorityUpstream() throws IOException {
        DmnResource loans = new DmnResource("loan-decision.dmn", corpus("C17-dmn-drd", "loan-decision.dmn"));

        DmnEvaluation young = evaluator.evaluate(loans, null, Map.of("age", 19, "country", "DE", "income", 5000, "amount", 15000));
        assertThat(young.rows()).containsExactly(Map.of("offer", "REVIEW"));
        assertThat(young.decision("riskClass").matchedRules()).as("PRIORITY chose HIGH although the catch-all rule matched too")
            .containsExactly("riskClass_highYoung");

        DmnEvaluation adult = evaluator.evaluate(loans, "loanOffer", Map.of("age", 30, "country", "DE", "income", 5000, "amount", 15000));
        assertThat(adult.rows()).containsExactly(Map.of("offer", "APPROVE"));
    }
}
