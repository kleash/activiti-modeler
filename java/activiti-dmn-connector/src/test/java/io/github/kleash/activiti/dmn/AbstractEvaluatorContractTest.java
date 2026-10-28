package io.github.kleash.activiti.dmn;

import static io.github.kleash.activiti.dmn.DmnFixtures.decisionXml;
import static io.github.kleash.activiti.dmn.DmnFixtures.document;
import static io.github.kleash.activiti.dmn.DmnFixtures.rule;
import static io.github.kleash.activiti.dmn.DmnFixtures.singleTable;
import static io.github.kleash.activiti.dmn.DmnFixtures.tableXml;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import io.github.kleash.activiti.dmn.DmnFixtures.In;
import io.github.kleash.activiti.dmn.DmnFixtures.Out;

/**
 * The behaviour every {@link DmnEvaluator} must show: all seven hit policies, the four COLLECT aggregators, literal
 * expressions, DRD chaining (including PRIORITY and OUTPUT ORDER feeding a downstream decision), matched rules and the
 * no-match behaviour. The Operaton and the KIE evaluator both run exactly these cases, which is what makes their
 * results interchangeable.
 */
public abstract class AbstractEvaluatorContractTest {

    private static final In N = new In("n", "number");
    private static final Out OUT = new Out("out", "string", null);
    private static final Out NUM = new Out("out", "number", null);

    /** @return the engine under test */
    protected abstract DmnEvaluator evaluator();

    private DmnEvaluation evaluate(String xml, String decision, Map<String, Object> inputs) {
        return evaluator().evaluate(new DmnResource("test.dmn", xml), decision, inputs);
    }

    record Case(String name, String xml, String decision, Map<String, Object> inputs, List<Map<String, Object>> rows,
                List<String> matchedRules) {
        @Override
        public String toString() {
            return name;
        }
    }

    private static Case ok(String name, String xml, Map<String, Object> inputs, List<Map<String, Object>> rows, List<String> matched) {
        return new Case(name, xml, null, inputs, rows, matched);
    }

    private static Map<String, Object> row(Object... keyValues) {
        java.util.LinkedHashMap<String, Object> row = new java.util.LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            row.put((String) keyValues[i], keyValues[i + 1]);
        }
        return row;
    }

    private static String table(String hitPolicy, String aggregation, Out out, DmnFixtures.Rule... rules) {
        return singleTable("d", hitPolicy, aggregation, List.of(N), List.of(out), List.of(rules));
    }

    static Stream<Arguments> cases() {
        String unique = table("UNIQUE", null, OUT, rule("lt5", "< 5", "\"low\""), rule("ge5", ">= 5", "\"high\""));
        String uniqueGap = table("UNIQUE", null, OUT, rule("lt5", "< 5", "\"low\""), rule("gt10", "> 10", "\"high\""));
        String first = table("FIRST", null, OUT, rule("a", "> 0", "\"A\""), rule("b", "> 5", "\"B\""), rule("c", "-", "\"C\""));
        String any = table("ANY", null, OUT, rule("a", "< 10", "\"X\""), rule("b", "> 5", "\"X\""), rule("c", "> 100", "\"Y\""));
        Out risk = new Out("out", "string", "\"high\",\"mid\",\"low\"");
        String priority = table("PRIORITY", null, risk, rule("lo", "> 0", "\"low\""), rule("hi", "> 10", "\"high\""), rule("mid", "> 5", "\"mid\""));
        String priorityTie = table("PRIORITY", null, risk, rule("p1", "> 0", "\"high\""), rule("p2", "> 1", "\"high\""));
        String ruleOrder = table("RULE ORDER", null, OUT, rule("a", "> 0", "\"A\""), rule("b", "> 5", "\"B\""));
        Out cba = new Out("out", "string", "\"c\",\"b\",\"a\"");
        String outputOrder = table("OUTPUT ORDER", null, cba, rule("ra", "> 0", "\"a\""), rule("rb", "> 1", "\"b\""), rule("rc", "> 2", "\"c\""));
        Out xy = new Out("out", "string", "\"x\",\"y\"");
        String outputOrderTies = table("OUTPUT ORDER", null, xy, rule("r1", "> 0", "\"y\""), rule("r2", "> 0", "\"x\""), rule("r3", "> 0", "\"y\""));
        String collect = table("COLLECT", null, OUT, rule("a", "> 0", "\"A\""), rule("b", "> 5", "\"B\""));
        String sum = table("COLLECT", "SUM", NUM, rule("a", "> 0", "1"), rule("b", "> 5", "10"), rule("c", "> 100", "100"));
        String sumDuplicates = table("COLLECT", "SUM", NUM, rule("a", "> 0", "5"), rule("b", "> 1", "5"));
        String min = table("COLLECT", "MIN", NUM, rule("a", "> 0", "7"), rule("b", "> 5", "3"));
        String max = table("COLLECT", "MAX", NUM, rule("a", "> 0", "7"), rule("b", "> 5", "3"));
        String count = table("COLLECT", "COUNT", NUM, rule("a", "> 0", "1"), rule("b", "> 5", "2"));
        String countDuplicates = table("COLLECT", "COUNT", NUM, rule("a", "> 0", "1"), rule("b", "> 5", "1"));

        // two output columns: risk (high > low) is compared first, action (escalate > none) breaks ties
        Out risk2 = new Out("risk", "string", "\"high\",\"low\"");
        Out action = new Out("action", "string", "\"escalate\",\"none\"");
        List<DmnFixtures.Rule> twoOutputRules = List.of(
            rule("r1", List.of("-"), List.of("\"low\"", "\"escalate\"")),
            rule("r2", List.of("-"), List.of("\"high\"", "\"none\"")),
            rule("r3", List.of("-"), List.of("\"high\"", "\"escalate\"")),
            rule("r4", List.of("-"), List.of("\"low\"", "\"none\"")));
        String priorityTwo = singleTable("d", "PRIORITY", null, List.of(N), List.of(risk2, action), twoOutputRules);
        String outputOrderTwo = singleTable("d", "OUTPUT ORDER", null, List.of(N), List.of(risk2, action), twoOutputRules);
        String ruleOrderTwo = singleTable("d", "RULE ORDER", null, List.of(N), List.of(risk2, action), twoOutputRules);

        String literal = DmnFixtures.literal("d", List.of(N), "number", "n * 2 + 1");

        // DRD: badges (OUTPUT ORDER, list) -> topBadge (literal, first element); grade (UNIQUE) -> label (literal)
        Out badge = new Out("badge", "string", "\"star\",\"achiever\"");
        String drd = document("drd", List.of(N),
            decisionXml("badges", null, List.of(), List.of("n"),
                tableXml("badges", "OUTPUT ORDER", null, List.of(N), List.of(badge),
                    List.of(rule("p", ">= 0", "\"achiever\""), rule("s", ">= 80", "\"star\"")))),
            decisionXml("topBadge", "string", List.of("badges"), List.of(),
                "    <literalExpression id=\"topBadge_le\" typeRef=\"string\"><text>badges[1]</text></literalExpression>\n"));
        String priorityChain = document("chain", List.of(N),
            decisionXml("level", "string", List.of(), List.of("n"),
                tableXml("level", "PRIORITY", null, List.of(N), List.of(new Out("level", "string", "\"high\",\"low\"")),
                    List.of(rule("l", "> 0", "\"low\""), rule("h", "> 10", "\"high\"")))),
            decisionXml("action", "string", List.of("level"), List.of(),
                tableXml("action", "UNIQUE", null, List.of(new In("level", "string")), List.of(new Out("action", "string", null)),
                    List.of(rule("esc", "\"high\"", "\"escalate\""), rule("ign", "\"low\"", "\"ignore\"")))));

        return Stream.of(
            Arguments.of(ok("UNIQUE one match", unique, Map.of("n", 3), List.of(row("out", "low")), List.of("lt5"))),
            Arguments.of(ok("UNIQUE other rule", unique, Map.of("n", 5), List.of(row("out", "high")), List.of("ge5"))),
            Arguments.of(ok("UNIQUE no match", uniqueGap, Map.of("n", 7), List.of(), List.of())),
            Arguments.of(ok("FIRST returns the first matching rule", first, Map.of("n", 7), List.of(row("out", "A")), List.of("a"))),
            Arguments.of(ok("FIRST falls through to the catch-all", first, Map.of("n", -1), List.of(row("out", "C")), List.of("c"))),
            Arguments.of(ok("ANY with agreeing outputs", any, Map.of("n", 7), List.of(row("out", "X")), List.of("a"))),
            Arguments.of(ok("ANY with one match", any, Map.of("n", 2), List.of(row("out", "X")), List.of("a"))),
            Arguments.of(ok("ANY no match", table("ANY", null, OUT, rule("a", "> 100", "\"X\"")), Map.of("n", 2), List.of(), List.of())),
            Arguments.of(ok("PRIORITY picks the highest priority, not the first rule", priority, Map.of("n", 20), List.of(row("out", "high")), List.of("hi"))),
            Arguments.of(ok("PRIORITY among two matches", priority, Map.of("n", 7), List.of(row("out", "mid")), List.of("mid"))),
            Arguments.of(ok("PRIORITY single match", priority, Map.of("n", 1), List.of(row("out", "low")), List.of("lo"))),
            Arguments.of(ok("PRIORITY no match", priority, Map.of("n", -1), List.of(), List.of())),
            Arguments.of(ok("PRIORITY tie keeps rule order", priorityTie, Map.of("n", 5), List.of(row("out", "high")), List.of("p1"))),
            Arguments.of(ok("PRIORITY with two outputs compares column by column", priorityTwo, Map.of("n", 1),
                List.of(row("risk", "high", "action", "escalate")), List.of("r3"))),
            Arguments.of(ok("RULE ORDER", ruleOrder, Map.of("n", 7), List.of(row("out", "A"), row("out", "B")), List.of("a", "b"))),
            Arguments.of(ok("RULE ORDER one match", ruleOrder, Map.of("n", 2), List.of(row("out", "A")), List.of("a"))),
            Arguments.of(ok("RULE ORDER no match", ruleOrder, Map.of("n", -2), List.of(), List.of())),
            Arguments.of(ok("RULE ORDER with two outputs", ruleOrderTwo, Map.of("n", 1),
                List.of(row("risk", "low", "action", "escalate"), row("risk", "high", "action", "none"),
                    row("risk", "high", "action", "escalate"), row("risk", "low", "action", "none")),
                List.of("r1", "r2", "r3", "r4"))),
            Arguments.of(ok("OUTPUT ORDER sorts by outputValues, not by rule order", outputOrder, Map.of("n", 5),
                List.of(row("out", "c"), row("out", "b"), row("out", "a")), List.of("rc", "rb", "ra"))),
            Arguments.of(ok("OUTPUT ORDER with fewer matches", outputOrder, Map.of("n", 0.5), List.of(row("out", "a")), List.of("ra"))),
            Arguments.of(ok("OUTPUT ORDER ties keep rule order", outputOrderTies, Map.of("n", 1),
                List.of(row("out", "x"), row("out", "y"), row("out", "y")), List.of("r2", "r1", "r3"))),
            Arguments.of(ok("OUTPUT ORDER no match", outputOrder, Map.of("n", -1), List.of(), List.of())),
            Arguments.of(ok("OUTPUT ORDER with two outputs is lexicographic in column order", outputOrderTwo, Map.of("n", 1),
                List.of(row("risk", "high", "action", "escalate"), row("risk", "high", "action", "none"),
                    row("risk", "low", "action", "escalate"), row("risk", "low", "action", "none")),
                List.of("r3", "r2", "r1", "r4"))),
            Arguments.of(ok("COLLECT list", collect, Map.of("n", 7), List.of(row("out", "A"), row("out", "B")), List.of("a", "b"))),
            Arguments.of(ok("COLLECT list no match", collect, Map.of("n", -1), List.of(), List.of())),
            Arguments.of(ok("COLLECT SUM", sum, Map.of("n", 7), List.of(row("out", 11L)), List.of("a", "b"))),
            Arguments.of(ok("COLLECT SUM of all three", sum, Map.of("n", 700), List.of(row("out", 111L)), List.of("a", "b", "c"))),
            Arguments.of(ok("COLLECT SUM no match emits nothing", sum, Map.of("n", -1), List.of(), List.of())),
            Arguments.of(ok("COLLECT SUM adds equal outputs", sumDuplicates, Map.of("n", 7), List.of(row("out", 10L)), List.of("a", "b"))),
            Arguments.of(ok("COLLECT MIN", min, Map.of("n", 7), List.of(row("out", 3L)), List.of("a", "b"))),
            Arguments.of(ok("COLLECT MIN one match", min, Map.of("n", 1), List.of(row("out", 7L)), List.of("a"))),
            Arguments.of(ok("COLLECT MIN no match emits nothing", min, Map.of("n", -1), List.of(), List.of())),
            Arguments.of(ok("COLLECT MAX", max, Map.of("n", 7), List.of(row("out", 7L)), List.of("a", "b"))),
            Arguments.of(ok("COLLECT MAX no match emits nothing", max, Map.of("n", -1), List.of(), List.of())),
            Arguments.of(ok("COLLECT COUNT", count, Map.of("n", 7), List.of(row("out", 2L)), List.of("a", "b"))),
            Arguments.of(ok("COLLECT COUNT counts distinct output values", countDuplicates, Map.of("n", 7), List.of(row("out", 1L)), List.of("a", "b"))),
            Arguments.of(ok("COLLECT COUNT of nothing is 0", count, Map.of("n", -1), List.of(row("out", 0L)), List.of())),
            Arguments.of(ok("literal expression", literal, Map.of("n", 4), List.of(row("d", 9L)), List.of())),
            Arguments.of(new Case("DRD: literal expression on an OUTPUT ORDER decision", drd, "topBadge", Map.of("n", 85),
                List.of(row("topBadge", "star")), List.of())),
            Arguments.of(new Case("DRD: PRIORITY result feeds a UNIQUE table", priorityChain, "action", Map.of("n", 20),
                List.of(row("action", "escalate")), List.of("esc"))),
            Arguments.of(new Case("DRD: PRIORITY result feeds a UNIQUE table (low)", priorityChain, "action", Map.of("n", 5),
                List.of(row("action", "ignore")), List.of("ign"))));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    void evaluatesAsSpecified(Case c) {
        DmnEvaluation evaluation = evaluate(c.xml(), c.decision(), c.inputs());

        assertThat(evaluation.rows()).as("result rows").containsExactlyElementsOf(c.rows());
        assertThat(evaluation.matchedRules()).as("matched rules").containsExactlyElementsOf(c.matchedRules());
    }

    @Test
    void sinkDecisionIsChosenWhenNoDecisionIsRequested() {
        Case c = (Case) cases().map(a -> a.get()[0]).filter(x -> ((Case) x).name().startsWith("DRD: literal")).findFirst().orElseThrow();
        DmnEvaluation evaluation = evaluate(c.xml(), null, c.inputs());

        assertThat(evaluation.decisionId()).isEqualTo("topBadge");
        assertThat(evaluation.decisions()).extracting(DecisionEvaluation::decisionId).containsExactly("badges", "topBadge");
    }

    @Test
    void everyDecisionOfADrdReportsItsOwnResultAndMatchedRules() {
        Case c = (Case) cases().map(a -> a.get()[0]).filter(x -> ((Case) x).name().startsWith("DRD: literal")).findFirst().orElseThrow();
        DmnEvaluation evaluation = evaluate(c.xml(), "topBadge", c.inputs());

        DecisionEvaluation badges = evaluation.decision("badges");
        assertThat(badges.hitPolicy()).isEqualTo(DmnHitPolicy.OUTPUT_ORDER);
        assertThat(badges.multiResult()).isTrue();
        assertThat(badges.rows()).containsExactly(row("badge", "star"), row("badge", "achiever"));
        assertThat(badges.matchedRules()).containsExactly("s", "p");
        assertThat(evaluation.decision("topBadge").rows()).containsExactly(row("topBadge", "star"));
        assertThat(evaluation.decision("nothing")).isNull();
    }

    @Test
    void twoMatchingRulesViolateUnique() {
        String xml = table("UNIQUE", null, OUT, rule("a", "> 0", "\"A\""), rule("b", "> 5", "\"B\""));

        assertThatThrownBy(() -> evaluate(xml, null, Map.of("n", 7))).isInstanceOf(DmnException.class);
    }

    @Test
    void anyWithDifferentOutputsIsAnError() {
        String xml = table("ANY", null, OUT, rule("a", "> 0", "\"A\""), rule("b", "> 5", "\"B\""));

        assertThatThrownBy(() -> evaluate(xml, null, Map.of("n", 7))).isInstanceOf(DmnException.class);
    }

    @Test
    void unknownDecisionIsAResolutionError() {
        String xml = table("UNIQUE", null, OUT, rule("a", "> 0", "\"A\""));

        assertThatThrownBy(() -> evaluate(xml, "nope", Map.of("n", 7))).isInstanceOf(DmnResolutionException.class);
    }

    @Test
    void malformedXmlIsAModelError() {
        assertThatThrownBy(() -> evaluate("<definitions", null, Map.of())).isInstanceOf(DmnModelException.class);
    }
}
