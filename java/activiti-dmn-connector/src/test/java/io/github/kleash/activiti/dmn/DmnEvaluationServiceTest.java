package io.github.kleash.activiti.dmn;

import static io.github.kleash.activiti.dmn.DmnFixtures.rule;
import static io.github.kleash.activiti.dmn.DmnFixtures.singleTable;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import io.github.kleash.activiti.dmn.DmnFixtures.In;
import io.github.kleash.activiti.dmn.DmnFixtures.Out;
import io.github.kleash.activiti.dmn.testing.FolderRepository;

/** Direct evaluation, as used by the REST endpoint and the scenario runner. */
class DmnEvaluationServiceTest {

    private final DmnEvaluationService service = new DmnEvaluationService(new OperatonDmnEvaluator(),
        new DmnDeploymentResolver(FolderRepository.of(Path.of("..", "..", "corpus", "C17-dmn-drd", "seed", "processes").toAbsolutePath().normalize()), 8));

    private static final String XML = singleTable("grade", "UNIQUE", null, List.of(new In("score", "number")), List.of(new Out("g", "string", null)),
        List.of(rule("low", "< 50", "\"low\""), rule("high", ">= 50", "\"high\"")));

    @Test
    void evaluatesInlineXmlAndStripsReservedInputs() {
        DmnEvaluation evaluation = service.evaluateXml(XML, null, Map.of("score", 70, "_activiti_dmn_table_", "ignored"));

        assertThat(evaluation.decisionId()).isEqualTo("grade");
        assertThat(evaluation.rows()).containsExactly(Map.of("g", "high"));
        assertThat(evaluation.matchedRules()).containsExactly("high");
    }

    @Test
    void inlineXmlSelectsByDecisionId() {
        assertThat(service.evaluateXml(XML, "grade", Map.of("score", 1)).matchedRules()).containsExactly("low");
        assertThat(service.evaluateXml(XML, "grade", Map.of("score", 1)).decisionId()).isEqualTo("grade");
        assertThatThrownBy(() -> service.evaluateXml(XML, "nope", Map.of("score", 1))).isInstanceOf(DmnResolutionException.class);
    }

    @Test
    void evaluatesAgainstADeploymentWithAnyOfTheThreeReferences() {
        Map<String, Object> inputs = Map.of("age", 30, "country", "DE", "income", 5000, "amount", 15000);

        for (String reference : List.of("loanOffer", "loan-decision", "Loan decision")) {
            DmnEvaluation evaluation = service.evaluateInDeployment(FolderRepository.DEPLOYMENT_ID, reference, inputs);
            assertThat(evaluation.decisionId()).as(reference).isEqualTo("loanOffer");
            assertThat(evaluation.rows()).as(reference).containsExactly(Map.of("offer", "APPROVE"));
        }
        assertThat(service.evaluateInDeployment(FolderRepository.DEPLOYMENT_ID, "riskClass", inputs).rows())
            .containsExactly(Map.of("riskClass", "LOW"));
    }

    @Test
    void unknownReferenceIsAResolutionError() {
        assertThatThrownBy(() -> service.evaluateInDeployment(FolderRepository.DEPLOYMENT_ID, "nope", Map.of()))
            .isInstanceOf(DmnResolutionException.class);
    }

    @Test
    void exposesItsCollaborators() {
        assertThat(service.evaluator()).isInstanceOf(OperatonDmnEvaluator.class);
        assertThat(service.resolver()).isNotNull();
    }
}
