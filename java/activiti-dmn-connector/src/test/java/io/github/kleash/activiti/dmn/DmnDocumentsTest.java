package io.github.kleash.activiti.dmn;

import static io.github.kleash.activiti.dmn.DmnFixtures.decisionXml;
import static io.github.kleash.activiti.dmn.DmnFixtures.document;
import static io.github.kleash.activiti.dmn.DmnFixtures.rule;
import static io.github.kleash.activiti.dmn.DmnFixtures.tableXml;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;

import io.github.kleash.activiti.dmn.DmnFixtures.In;
import io.github.kleash.activiti.dmn.DmnFixtures.Out;

class DmnDocumentsTest {

    @Test
    void isolateKeepsOnlyTheDecisionItsInputDataAndTypes() throws IOException {
        String xml = Files.readString(Path.of("..", "..", "corpus", "C17-dmn-drd", "seed", "processes", "loan-decision.dmn"));

        String isolated = DmnDocuments.isolateDecision(xml, "riskClass");
        DmnModel model = DmnModel.parse(isolated);

        assertThat(model.decisions()).extracting(DmnModel.DecisionInfo::id).containsExactly("riskClass");
        assertThat(model.decision("riskClass").orElseThrow().requiredInputIds()).as("requirements are removed").isEmpty();
        assertThat(DmnDocuments.definitionsChildren(isolated)).doesNotContain("DMNDI").contains("inputData", "decision");
    }

    @Test
    void isolateRewritesPriorityAndOutputOrderToRuleOrder() {
        for (String policy : List.of("PRIORITY", "OUTPUT ORDER")) {
            String xml = document("x", List.of(new In("n", "number")), decisionXml("d", null, List.of(), List.of("n"),
                tableXml("d", policy, null, List.of(new In("n", "number")), List.of(new Out("o", "string", "\"a\"")), List.of(rule("r", "-", "\"a\"")))));

            DmnModel isolated = DmnModel.parse(DmnDocuments.isolateDecision(xml, "d"));

            assertThat(isolated.decision("d").orElseThrow().hitPolicy()).as(policy).isEqualTo(DmnHitPolicy.RULE_ORDER);
        }
    }

    @Test
    void isolateLeavesOtherHitPoliciesAlone() {
        String xml = document("x", List.of(new In("n", "number")), decisionXml("d", null, List.of(), List.of("n"),
            tableXml("d", "COLLECT", "SUM", List.of(new In("n", "number")), List.of(new Out("o", "number", null)), List.of(rule("r", "-", "1")))));

        DmnModel.DecisionInfo decision = DmnModel.parse(DmnDocuments.isolateDecision(xml, "d")).decision("d").orElseThrow();

        assertThat(decision.hitPolicy()).isEqualTo(DmnHitPolicy.COLLECT);
        assertThat(decision.aggregation()).isEqualTo(DmnAggregation.SUM);
    }

    @Test
    void isolateRejectsAnUnknownDecision() {
        String xml = document("x", List.of(), "  <decision id=\"d\" name=\"d\"/>\n");

        assertThatThrownBy(() -> DmnDocuments.isolateDecision(xml, "other")).isInstanceOf(DmnModelException.class).hasMessageContaining("'other'");
    }

    @Test
    void withHitPolicyRewritesOneTableAndKeepsTheRest() {
        String xml = document("x", List.of(new In("n", "number")), decisionXml("d", null, List.of(), List.of("n"),
            tableXml("d", "OUTPUT ORDER", null, List.of(new In("n", "number")), List.of(new Out("o", "string", "\"a\"")), List.of(rule("r", "-", "\"a\"")))));

        DmnModel rewritten = DmnModel.parse(DmnDocuments.withHitPolicy(xml, "d", DmnHitPolicy.RULE_ORDER));

        assertThat(rewritten.decision("d").orElseThrow().hitPolicy()).isEqualTo(DmnHitPolicy.RULE_ORDER);
        assertThat(rewritten.decision("d").orElseThrow().outputs().get(0).outputValuesText()).isEqualTo("\"a\"");
        assertThatThrownBy(() -> DmnDocuments.withHitPolicy(xml, "missing", DmnHitPolicy.FIRST)).isInstanceOf(DmnModelException.class);
    }
}
