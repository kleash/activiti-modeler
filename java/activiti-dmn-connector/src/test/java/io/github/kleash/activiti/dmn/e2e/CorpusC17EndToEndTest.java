package io.github.kleash.activiti.dmn.e2e;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.github.kleash.activiti.dmn.DmnEvaluation;

/**
 * Deploys the seed project {@code corpus/C17-dmn-drd} (a three-decision DRD: PRIORITY, literal expression, UNIQUE sink)
 * into embedded Activiti 9.0.0 and runs its scenario files. The three processes reference the same DMN file by
 * decision id, by file base name and by model name.
 */
@SpringBootTest(classes = E2eApplication.class)
class CorpusC17EndToEndTest extends AbstractCorpusEndToEndTest {

    private static final Path PROJECT = corpus("C17-dmn-drd");

    @DynamicPropertySource
    static void deployProject(DynamicPropertyRegistry registry) {
        deploy(registry, PROJECT);
    }

    @Override
    protected Path project() {
        return PROJECT;
    }

    @Override
    protected int expectedScenarioFiles() {
        return 3;
    }

    @Test
    void deploymentHoldsTheDrdAndThreeProcesses() {
        List<String> resources = repositoryService.getDeploymentResourceNames(deploymentId());

        assertThat(resources).filteredOn(n -> n.endsWith("loan-decision.dmn")).hasSize(1);
        assertThat(repositoryService.createProcessDefinitionQuery().list()).extracting(d -> d.getKey())
            .containsExactlyInAnyOrder("loanApplication", "loanApplicationByFile", "loanApplicationByModelName");
    }

    @Test
    void sinkDecisionOfTheDrdIsEvaluatedAndEveryRequiredDecisionIsReported() {
        DmnEvaluation evaluation = decisions.evaluateInDeployment(deploymentId(), "loan-decision",
            Map.of("age", 19, "country", "US", "income", 5000, "amount", 15000));

        assertThat(evaluation.decisionId()).isEqualTo("loanOffer");
        assertThat(evaluation.decisions()).extracting(d -> d.decisionId())
            .as("required decisions come first, the requested decision last").endsWith("loanOffer")
            .containsExactlyInAnyOrder("riskClass", "maxLoan", "loanOffer");
        assertThat(evaluation.decision("riskClass").rows()).containsExactly(Map.of("riskClass", "HIGH"));
        assertThat(evaluation.decision("riskClass").matchedRules()).containsExactly("riskClass_highYoung");
        assertThat(evaluation.decision("maxLoan").rows()).containsExactly(Map.of("maxLoan", 20000L));
        assertThat(evaluation.rows()).containsExactly(Map.of("offer", "REVIEW"));
    }

    @Test
    void missingInputsSurfaceAsNoMatchNotAsAnException() {
        DmnEvaluation evaluation = decisions.evaluateInDeployment(deploymentId(), "loanOffer", Map.of("amount", 1));

        assertThat(evaluation.matched()).isFalse();
    }

    @Test
    void unresolvableReferenceListsWhatIsAvailable() {
        assertThatThrownBy(() -> decisions.evaluateInDeployment(deploymentId(), "nope", Map.of()))
            .hasMessageContaining("neither a DMN resource name, a DMN definitions name nor a decision id")
            .hasMessageContaining("loan-decision").hasMessageContaining("Loan decision").hasMessageContaining("loanOffer");
    }
}
