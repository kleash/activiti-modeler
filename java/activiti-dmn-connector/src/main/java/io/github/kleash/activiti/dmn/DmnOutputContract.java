package io.github.kleash.activiti.dmn;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The output contract of the decision task (ADR 0004): turns a {@link DmnEvaluation} into the outbound variables of
 * the connector.
 *
 * <table>
 *   <caption>Outbound variables</caption>
 *   <tr><th>Variable</th><th>When</th><th>Value</th></tr>
 *   <tr><td>{@code <output name>} (one per output column)</td>
 *       <td>single result: UNIQUE, FIRST, ANY, PRIORITY, COLLECT with an aggregator; literal expression
 *           ({@code <variable name>})</td>
 *       <td>the column value; not emitted when nothing matched or the value is {@code null}</td></tr>
 *   <tr><td>{@code <decisionId>}</td>
 *       <td>multi result: COLLECT without aggregator, RULE ORDER, OUTPUT ORDER</td>
 *       <td>list of row maps in hit-policy order (empty list when nothing matched)</td></tr>
 *   <tr><td>{@value #MATCHED}</td><td>always</td><td>boolean</td></tr>
 *   <tr><td>{@value #MATCHED_RULES}</td><td>always</td><td>list of rule ids, in result order</td></tr>
 * </table>
 *
 * <p>These variables reach the process only through the service task's output mappings. For a DRD only the
 * requested (sink) decision's result is exposed; the other decisions are available through
 * {@link DmnEvaluation#decisions()}.
 */
public final class DmnOutputContract {

    /** Outbound boolean: whether the decision matched (see {@link DecisionEvaluation#matched()}). */
    public static final String MATCHED = "_activiti_dmn_matched_";

    /** Outbound list of the matched rule ids, in result order. */
    public static final String MATCHED_RULES = "_activiti_dmn_matched_rules_";

    /** Prefix of the reserved constants that are removed from the decision inputs. */
    public static final String RESERVED_PREFIX = "_activiti_";

    private DmnOutputContract() {
    }

    /**
     * Builds the outbound variables.
     *
     * @param evaluation the evaluation of the requested decision
     * @return a mutable map of outbound variable names to plain (serialisable) values
     */
    public static Map<String, Object> outboundVariables(DmnEvaluation evaluation) {
        DecisionEvaluation decision = evaluation.requested();
        Map<String, Object> outbound = new LinkedHashMap<>();
        if (decision.multiResult()) {
            List<Object> rows = new ArrayList<>();
            for (Map<String, Object> row : decision.rows()) {
                rows.add(new LinkedHashMap<>(row));
            }
            outbound.put(decision.decisionId(), rows);
        } else if (!decision.rows().isEmpty()) {
            decision.rows().get(0).forEach((name, value) -> {
                if (value != null) {
                    outbound.put(name, value);
                }
            });
        }
        outbound.put(MATCHED, decision.matched());
        outbound.put(MATCHED_RULES, new ArrayList<>(decision.matchedRules()));
        return outbound;
    }

    /**
     * Removes the reserved {@code _activiti_*} entries (such as {@code _activiti_dmn_table_}) from connector inputs.
     *
     * @param inbound the inbound variables of the connector
     * @return a new map without the reserved entries
     */
    public static Map<String, Object> decisionInputs(Map<String, Object> inbound) {
        Map<String, Object> inputs = new LinkedHashMap<>();
        inbound.forEach((name, value) -> {
            if (!name.startsWith(RESERVED_PREFIX)) {
                inputs.put(name, value);
            }
        });
        return inputs;
    }
}
