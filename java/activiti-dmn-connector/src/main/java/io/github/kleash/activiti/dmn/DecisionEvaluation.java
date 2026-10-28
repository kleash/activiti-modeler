package io.github.kleash.activiti.dmn;

import java.util.List;
import java.util.Map;

/**
 * The outcome of evaluating one decision.
 *
 * <p>{@code rows} is the decision's result as a list of rows (output column name to value):
 * <ul>
 *   <li>UNIQUE, FIRST, ANY, PRIORITY: zero rows (no rule matched) or one row;</li>
 *   <li>COLLECT with an aggregator: zero rows (nothing to aggregate) or one row holding the aggregate;</li>
 *   <li>COLLECT without aggregator, RULE ORDER, OUTPUT ORDER: one row per selected rule, in result order;</li>
 *   <li>literal expression: one row {@code {<variable name>: value}}, or zero rows when the value is {@code null}.</li>
 * </ul>
 *
 * <p>{@code matchedRules} are the ids of the rules behind the rows, in result order:
 * <ul>
 *   <li>UNIQUE: the one matched rule;</li>
 *   <li>FIRST: the first matched rule in rule order;</li>
 *   <li>ANY: the first matched rule (all matched rules produce the same output);</li>
 *   <li>PRIORITY: the matched rule with the highest output priority (ties: first in rule order);</li>
 *   <li>RULE ORDER, COLLECT (with or without aggregator): all matched rules in rule order;</li>
 *   <li>OUTPUT ORDER: all matched rules in output priority order;</li>
 *   <li>literal expression: empty.</li>
 * </ul>
 *
 * <p>An aggregating COLLECT with no matching rule yields no row, except COUNT, which yields {@code 0}.
 *
 * @param decisionId   the decision id
 * @param decisionName the decision name
 * @param kind         whether the decision is a table or a literal expression
 * @param hitPolicy    the hit policy of a decision table, otherwise {@code null}
 * @param aggregation  the aggregator of a COLLECT table, otherwise {@link DmnAggregation#NONE}
 * @param multiResult  {@code true} when the decision yields a list (COLLECT without aggregator, RULE ORDER, OUTPUT ORDER)
 * @param resultName   the name other decisions know the result by (the decision's variable name)
 * @param rows         the result rows, see above
 * @param matchedRules the ids of the rules behind the rows, see above
 */
public record DecisionEvaluation(
    String decisionId,
    String decisionName,
    DmnModel.Kind kind,
    DmnHitPolicy hitPolicy,
    DmnAggregation aggregation,
    boolean multiResult,
    String resultName,
    List<Map<String, Object>> rows,
    List<String> matchedRules) {

    /** Makes the lists unmodifiable copies. */
    public DecisionEvaluation {
        rows = rows.stream().map(row -> java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(row))).toList();
        matchedRules = List.copyOf(matchedRules);
    }

    /**
     * Whether the decision matched: at least one rule matched (decision table), or the expression produced a
     * value (literal expression).
     *
     * @return {@code true} when the decision matched
     */
    public boolean matched() {
        return kind == DmnModel.Kind.DECISION_TABLE ? !matchedRules.isEmpty() : !rows.isEmpty();
    }
}
