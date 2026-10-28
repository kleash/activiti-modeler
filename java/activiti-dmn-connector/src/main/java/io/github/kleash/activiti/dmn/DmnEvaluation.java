package io.github.kleash.activiti.dmn;

import java.util.List;
import java.util.Map;

/**
 * What a {@link DmnEvaluator} returns: the result of the requested decision plus, for a DRD, the results of every
 * decision that was evaluated on the way.
 *
 * @param requested the requested decision's result (always also the last element of {@code decisions})
 * @param decisions every evaluated decision in evaluation order, required decisions first
 */
public record DmnEvaluation(DecisionEvaluation requested, List<DecisionEvaluation> decisions) {

    /** Makes the list an unmodifiable copy. */
    public DmnEvaluation {
        decisions = List.copyOf(decisions);
    }

    /** @return the id of the requested decision */
    public String decisionId() {
        return requested.decisionId();
    }

    /** @return the result rows of the requested decision, see {@link DecisionEvaluation} */
    public List<Map<String, Object>> rows() {
        return requested.rows();
    }

    /** @return the ids of the rules that produced the requested decision's rows, in result order */
    public List<String> matchedRules() {
        return requested.matchedRules();
    }

    /** @return whether the requested decision produced a result */
    public boolean matched() {
        return requested.matched();
    }

    /**
     * Looks up the result of one evaluated decision.
     *
     * @param decisionId the decision id
     * @return its result, or {@code null} when that decision was not evaluated
     */
    public DecisionEvaluation decision(String decisionId) {
        return decisions.stream().filter(d -> d.decisionId().equals(decisionId)).findFirst().orElse(null);
    }
}
