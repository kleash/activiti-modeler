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
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import io.github.kleash.activiti.dmn.DmnFixtures.In;
import io.github.kleash.activiti.dmn.DmnFixtures.Out;

class DmnModelTest {

    private static final In N = new In("n", "number");
    private static final Out OUT = new Out("out", "string", null);

    @Test
    void readsTheLoanDrdOfTheCorpus() throws IOException {
        DmnModel model = DmnModel.parse(Files.readString(Path.of("..", "..", "corpus", "C17-dmn-drd", "seed", "processes", "loan-decision.dmn")));

        assertThat(model.definitionsName()).isEqualTo("Loan decision");
        assertThat(model.definitionsId()).isEqualTo("Definitions_loanDecision");
        assertThat(model.decisions()).extracting(DmnModel.DecisionInfo::id).containsExactly("riskClass", "maxLoan", "loanOffer");
        assertThat(model.sinkDecisions()).extracting(DmnModel.DecisionInfo::id).containsExactly("loanOffer");
        assertThat(model.sink().id()).isEqualTo("loanOffer");

        DmnModel.DecisionInfo risk = model.decision("riskClass").orElseThrow();
        assertThat(risk.kind()).isEqualTo(DmnModel.Kind.DECISION_TABLE);
        assertThat(risk.hitPolicy()).isEqualTo(DmnHitPolicy.PRIORITY);
        assertThat(risk.inputCount()).isEqualTo(2);
        assertThat(risk.outputs()).extracting(DmnModel.OutputInfo::name).containsExactly("riskClass");
        assertThat(risk.outputs().get(0).outputValuesText()).isEqualTo("\"HIGH\",\"MEDIUM\",\"LOW\"");
        assertThat(risk.ruleIds()).containsExactly("riskClass_highYoung", "riskClass_mediumAbroad", "riskClass_lowDefault");
        assertThat(risk.requiredInputIds()).containsExactly("InputData_age", "InputData_country");
        assertThat(risk.isMultiResult()).isFalse();

        DmnModel.DecisionInfo maxLoan = model.decision("maxLoan").orElseThrow();
        assertThat(maxLoan.kind()).isEqualTo(DmnModel.Kind.LITERAL_EXPRESSION);
        assertThat(maxLoan.hitPolicy()).isNull();
        assertThat(maxLoan.isTable()).isFalse();

        assertThat(model.decision("loanOffer").orElseThrow().requiredDecisionIds()).containsExactly("riskClass", "maxLoan");
    }

    @Test
    void evaluationOrderPutsRequirementsFirst() throws IOException {
        DmnModel model = DmnModel.parse(Files.readString(Path.of("..", "..", "corpus", "C17-dmn-drd", "seed", "processes", "loan-decision.dmn")));

        assertThat(model.evaluationOrder("loanOffer")).extracting(DmnModel.DecisionInfo::id)
            .containsExactly("riskClass", "maxLoan", "loanOffer");
        assertThat(model.evaluationOrder("maxLoan")).extracting(DmnModel.DecisionInfo::id).containsExactly("maxLoan");
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "UNIQUE|NONE|false", "FIRST|NONE|false", "ANY|NONE|false", "PRIORITY|NONE|false",
        "RULE ORDER|NONE|true", "OUTPUT ORDER|NONE|true", "COLLECT|NONE|true",
        "COLLECT|SUM|false", "COLLECT|MIN|false", "COLLECT|MAX|false", "COLLECT|COUNT|false"})
    void knowsWhichHitPoliciesReturnAList(String hitPolicy, String aggregation, boolean multi) {
        String agg = "NONE".equals(aggregation) ? null : aggregation;
        Out out = hitPolicy.contains("PRIORITY") || hitPolicy.contains("ORDER") ? new Out("out", "string", "\"a\"") : OUT;
        DmnModel model = DmnModel.parse(singleTable("d", hitPolicy, agg, List.of(N), List.of(out), List.of(rule("r", "-", "\"a\""))));

        DmnModel.DecisionInfo decision = model.decision("d").orElseThrow();
        assertThat(decision.isMultiResult()).isEqualTo(multi);
        assertThat(decision.aggregation()).isEqualTo(DmnAggregation.valueOf(aggregation));
    }

    @Test
    void ruleWithoutIdGetsASynthesizedId() {
        String xml = document("x", List.of(N), decisionXml("d", null, List.of(), List.of("n"),
            "    <decisionTable id=\"t\"><input id=\"i\"><inputExpression><text>n</text></inputExpression></input>"
                + "<output id=\"o\" name=\"out\"/><rule><inputEntry><text>-</text></inputEntry><outputEntry><text>\"a\"</text></outputEntry></rule>"
                + "<rule id=\"named\"><inputEntry><text>-</text></inputEntry><outputEntry><text>\"b\"</text></outputEntry></rule></decisionTable>\n"));

        assertThat(DmnModel.parse(xml).decision("d").orElseThrow().ruleIds()).containsExactly("d_rule1", "named");
    }

    @Test
    void hitPolicyDefaultsToUnique() {
        String xml = document("x", List.of(N), decisionXml("d", null, List.of(), List.of("n"),
            "    <decisionTable id=\"t\"><input id=\"i\"><inputExpression><text>n</text></inputExpression></input><output id=\"o\" name=\"out\"/></decisionTable>\n"));

        assertThat(DmnModel.parse(xml).decision("d").orElseThrow().hitPolicy()).isEqualTo(DmnHitPolicy.UNIQUE);
    }

    @Test
    void resultNameIsTheVariableNameOtherwiseTheDecisionName() {
        String withVariable = document("x", List.of(), "  <decision id=\"d\" name=\"Name\"><variable id=\"v\" name=\"varName\"/><literalExpression><text>1</text></literalExpression></decision>");
        String without = document("x", List.of(), "  <decision id=\"d\" name=\"Name\"><literalExpression><text>1</text></literalExpression></decision>");

        assertThat(DmnModel.parse(withVariable).sink().resultName()).isEqualTo("varName");
        assertThat(DmnModel.parse(without).sink().resultName()).isEqualTo("Name");
    }

    @Test
    void classifiesBoxedExpressionsAndKnowledgeRequirements() throws IOException {
        DmnModel model = DmnModel.parse(Files.readString(Path.of("..", "..", "corpus", "C17-dmn-drd-kie", "seed", "processes", "pricing.dmn")));

        DmnModel.DecisionInfo price = model.decision("finalPrice").orElseThrow();
        assertThat(price.kind()).isEqualTo(DmnModel.Kind.OTHER_BOXED_EXPRESSION);
        assertThat(price.expressionElement()).isEqualTo("context");
        assertThat(price.requiresKnowledge()).isTrue();
        assertThat(model.businessKnowledgeModelIds()).containsExactly("discountRate");
    }

    @Test
    void selectsByIdByDefinitionsNameOrDefaultsToTheSink() throws IOException {
        DmnModel model = DmnModel.parse(Files.readString(Path.of("..", "..", "corpus", "C17-dmn-drd", "seed", "processes", "loan-decision.dmn")));

        assertThat(model.select(null).id()).isEqualTo("loanOffer");
        assertThat(model.select(" ").id()).isEqualTo("loanOffer");
        assertThat(model.select("riskClass").id()).isEqualTo("riskClass");
        assertThat(model.select("Loan decision").id()).isEqualTo("loanOffer");
        assertThatThrownBy(() -> model.select("nope")).isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("riskClass").hasMessageContaining("loanOffer");
    }

    @Test
    void severalFinalDecisionsNeedAnExplicitId() {
        String xml = document("two", List.of(N),
            decisionXml("a", null, List.of(), List.of("n"), tableXml("a", "UNIQUE", null, List.of(N), List.of(OUT), List.of(rule("r", "-", "\"a\"")))),
            decisionXml("b", null, List.of(), List.of("n"), tableXml("b", "UNIQUE", null, List.of(N), List.of(OUT), List.of(rule("r2", "-", "\"b\"")))));
        DmnModel model = DmnModel.parse(xml);

        assertThat(model.sinkDecisions()).hasSize(2);
        assertThatThrownBy(model::sink).isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("2 final decisions").hasMessageContaining("reference one of them by decision id");
        assertThat(model.select("b").id()).isEqualTo("b");
    }

    @Test
    void documentWithoutDecisionsHasNoSink() {
        DmnModel model = DmnModel.parse(document("empty", List.of()));

        assertThatThrownBy(model::sink).isInstanceOf(DmnResolutionException.class).hasMessageContaining("defines no decision");
    }

    @Test
    void cyclesAreRejected() {
        String xml = document("cycle", List.of(),
            decisionXml("a", null, List.of("b"), List.of(), "    <literalExpression><text>1</text></literalExpression>\n"),
            decisionXml("b", null, List.of("a"), List.of(), "    <literalExpression><text>1</text></literalExpression>\n"));
        DmnModel model = DmnModel.parse(xml);

        assertThatThrownBy(() -> model.evaluationOrder("a")).isInstanceOf(DmnModelException.class).hasMessageContaining("cycle");
        assertThatThrownBy(model::sink).isInstanceOf(DmnResolutionException.class).hasMessageContaining("cycle");
    }

    @Test
    void missingRequiredDecisionIsReported() {
        String xml = document("m", List.of(),
            decisionXml("a", null, List.of("ghost"), List.of(), "    <literalExpression><text>1</text></literalExpression>\n"));

        assertThatThrownBy(() -> DmnModel.parse(xml).evaluationOrder("a")).isInstanceOf(DmnModelException.class)
            .hasMessageContaining("'ghost' is required but not defined");
    }

    @Test
    void invalidDocumentsAreRejectedWithModelExceptions() {
        assertThatThrownBy(() -> DmnModel.parse("<definitions")).isInstanceOf(DmnModelException.class).hasMessageContaining("not well formed");
        assertThatThrownBy(() -> DmnModel.parse("<foo xmlns='x'/>")).isInstanceOf(DmnModelException.class).hasMessageContaining("Not a DMN document");
        assertThatThrownBy(() -> DmnModel.parse("<?xml version='1.0'?><!DOCTYPE d [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><definitions xmlns='x'>&e;</definitions>"))
            .as("DOCTYPE is refused (XXE)").isInstanceOf(DmnModelException.class);
        assertThatThrownBy(() -> DmnModel.parse(document("dup", List.of(),
            "  <decision id=\"d\" name=\"d\"/>\n", "  <decision id=\"d\" name=\"e\"/>\n"))).hasMessageContaining("Duplicate decision id 'd'");
        assertThatThrownBy(() -> DmnModel.parse(document("noid", List.of(), "  <decision name=\"d\"/>\n"))).hasMessageContaining("has no id");
        assertThatThrownBy(() -> DmnModel.parse(singleTable("d", "SOMETIMES", null, List.of(N), List.of(OUT), List.of())))
            .hasMessageContaining("Unknown hit policy 'SOMETIMES'");
        assertThatThrownBy(() -> DmnModel.parse(singleTable("d", "UNIQUE", "SUM", List.of(N), List.of(OUT), List.of())))
            .hasMessageContaining("aggregation SUM is only allowed with hit policy COLLECT");
        assertThatThrownBy(() -> DmnModel.parse(singleTable("d", "COLLECT", "MEDIAN", List.of(N), List.of(OUT), List.of())))
            .hasMessageContaining("Unknown aggregation 'MEDIAN'");
    }

    @Test
    void hitPolicyParsingAcceptsTheXmlSpellings() {
        assertThat(DmnHitPolicy.fromXml("RULE ORDER")).isEqualTo(DmnHitPolicy.RULE_ORDER);
        assertThat(DmnHitPolicy.fromXml("output order")).isEqualTo(DmnHitPolicy.OUTPUT_ORDER);
        assertThat(DmnHitPolicy.fromXml("OUTPUT_ORDER")).isEqualTo(DmnHitPolicy.OUTPUT_ORDER);
        assertThat(DmnHitPolicy.fromXml(null)).isEqualTo(DmnHitPolicy.UNIQUE);
        assertThat(DmnHitPolicy.PRIORITY.ordersByOutputValues()).isTrue();
        assertThat(DmnHitPolicy.COLLECT.ordersByOutputValues()).isFalse();
        assertThat(DmnHitPolicy.RULE_ORDER.xmlName()).isEqualTo("RULE ORDER");
    }
}
