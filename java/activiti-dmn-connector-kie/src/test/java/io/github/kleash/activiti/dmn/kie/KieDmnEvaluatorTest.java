package io.github.kleash.activiti.dmn.kie;

import static io.github.kleash.activiti.dmn.DmnFixtures.decisionXml;
import static io.github.kleash.activiti.dmn.DmnFixtures.document;
import static io.github.kleash.activiti.dmn.DmnFixtures.rule;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import io.github.kleash.activiti.dmn.DmnEvaluation;
import io.github.kleash.activiti.dmn.DmnException;
import io.github.kleash.activiti.dmn.DmnFixtures.In;
import io.github.kleash.activiti.dmn.DmnFixtures.Out;
import io.github.kleash.activiti.dmn.DmnModel;
import io.github.kleash.activiti.dmn.DmnModelException;
import io.github.kleash.activiti.dmn.DmnOutputContract;
import io.github.kleash.activiti.dmn.DmnResource;

/** What only the KIE engine can do, and how it reports problems (the shared contract is {@link KieEvaluatorContractTest}). */
class KieDmnEvaluatorTest {

    private static final In N = new In("n", "number");

    private final KieDmnEvaluator evaluator = new KieDmnEvaluator();

    private static DmnResource corpus(String project, String file) throws IOException {
        return new DmnResource(file, Files.readString(Path.of("..", "..", "corpus", project, "seed", "processes", file)));
    }

    @Test
    void namesItself() {
        assertThat(evaluator.engineName()).isEqualTo("kie");
        assertThat(KieDmnEngine.NAME).isEqualTo("kie-dmn");
    }

    @ParameterizedTest
    @CsvSource({"200,5,180", "200,2,190", "200,0,200", "1000,10,900", "50,1,50"})
    void invokesABusinessKnowledgeModelFromABoxedContext(int basePrice, int loyaltyYears, long expected) throws IOException {
        DmnResource pricing = corpus("C17-dmn-drd-kie", "pricing.dmn");

        DmnEvaluation evaluation = evaluator.evaluate(pricing, null, Map.of("basePrice", basePrice, "loyaltyYears", loyaltyYears));

        assertThat(evaluation.decisionId()).isEqualTo("finalPrice");
        assertThat(evaluation.rows()).containsExactly(Map.of("finalPrice", expected));
        assertThat(evaluation.matched()).isTrue();
        assertThat(evaluation.matchedRules()).isEmpty();
        assertThat(DmnOutputContract.outboundVariables(evaluation)).containsEntry("finalPrice", expected).containsEntry("_activiti_dmn_matched_", true);
    }

    @Test
    void decisionServicesAndBkmsDoNotBreakTheSinkLookup() throws IOException {
        DmnModel model = DmnModel.parse(corpus("C17-dmn-drd-kie", "pricing.dmn").xml());

        assertThat(model.sink().id()).isEqualTo("finalPrice");
        assertThat(model.businessKnowledgeModelIds()).containsExactly("discountRate");
    }

    @Test
    void evaluatesTheCorpusDrdWithPriorityUpstream() throws IOException {
        DmnResource loans = corpus("C17-dmn-drd", "loan-decision.dmn");

        DmnEvaluation young = evaluator.evaluate(loans, null, Map.of("age", 19, "country", "DE", "income", 5000, "amount", 15000));

        assertThat(young.rows()).containsExactly(Map.of("offer", "REVIEW"));
        assertThat(young.matchedRules()).containsExactly("loanOffer_review");
        assertThat(young.decision("riskClass").rows()).containsExactly(Map.of("riskClass", "HIGH"));
        assertThat(young.decision("riskClass").matchedRules()).containsExactly("riskClass_highYoung");
        assertThat(young.decision("maxLoan").rows()).containsExactly(Map.of("maxLoan", 20000L));
    }

    @Test
    void undeclaredInputDataIsACompileErrorNotASilentNoMatch() {
        // dmn-js style model without inputData: Operaton accepts it, KIE refuses (docs/user-guide/dmn-conventions.md)
        String xml = document("lenient", List.of(), decisionXml("d", null, List.of(), List.of(),
            tableXml("d", "UNIQUE", null, List.of(N), List.of(new Out("out", "string", null)), List.of(rule("r", "-", "\"a\"")))));

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("lenient.dmn", xml), null, Map.of("n", 1)))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("Unknown variable 'n'");
    }

    @Test
    void nonFeelTypeNamesAreACompileError() {
        String xml = document("types", List.of(new In("n", "integer")), decisionXml("d", null, List.of(), List.of("n"),
            tableXml("d", "UNIQUE", null, List.of(new In("n", "integer")), List.of(new Out("out", "string", null)), List.of(rule("r", "-", "\"a\"")))));

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("types.dmn", xml), null, Map.of("n", 1)))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("integer");
    }

    @Test
    void emptyInputEntriesAreACompileErrorUseADashForAny() {
        String xml = document("empty", List.of(N), decisionXml("d", null, List.of(), List.of("n"),
            tableXml("d", "UNIQUE", null, List.of(N), List.of(new Out("out", "string", null)), List.of(rule("r", "", "\"a\"")))));

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("empty.dmn", xml), null, Map.of("n", 1)))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("Missing test on decision table input entry");
    }

    @Test
    void concurrentEvaluationsStayConsistent() throws Exception {
        DmnResource resource = new DmnResource("c.dmn", document("conc", List.of(N), decisionXml("d", null, List.of(), List.of("n"),
            tableXml("d", "OUTPUT ORDER", null, List.of(N), List.of(new Out("out", "string", "\"high\",\"mid\",\"low\"")),
                List.of(rule("lo", "> 0", "\"low\""), rule("mid", "> 10", "\"mid\""), rule("hi", "> 100", "\"high\""))))));
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Callable<String>> jobs = new ArrayList<>();
            for (int i = 0; i < 200; i++) {
                int n = i % 3 == 0 ? 5 : i % 3 == 1 ? 50 : 500;
                List<String> expected = n == 5 ? List.of("lo") : n == 50 ? List.of("mid", "lo") : List.of("hi", "mid", "lo");
                jobs.add(() -> {
                    DmnEvaluation e = evaluator.evaluate(resource, null, Map.of("n", n));
                    return e.matchedRules().equals(expected) ? "ok" : "wrong: " + n + " -> " + e.matchedRules();
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
    void evaluationErrorsAreDmnExceptions() {
        String xml = document("err", List.of(N), decisionXml("d", null, List.of(), List.of("n"),
            tableXml("d", "UNIQUE", null, List.of(N), List.of(new Out("out", "string", null)),
                List.of(rule("a", "> 0", "\"a\""), rule("b", "> 1", "\"b\"")))));

        assertThatThrownBy(() -> evaluator.evaluate(new DmnResource("err.dmn", xml), null, Map.of("n", 5)))
            .isInstanceOf(DmnException.class);
    }
}
