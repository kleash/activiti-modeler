package io.github.kleash.activiti.dmn.kie;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import io.github.kleash.activiti.dmn.DecisionEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.DmnException;
import io.github.kleash.activiti.dmn.DmnResource;
import io.github.kleash.activiti.dmn.OperatonDmnEvaluator;

/**
 * Evaluates a DMN document with two engines (Operaton and KIE by default) and compares what the connector would see:
 * for every evaluated decision the result rows (numbers compared by value, not by Java type) and the matched rule ids
 * in order. It is the tool behind the corpus rule "every C16 and C17 decision gives the same answer on both engines"
 * and a way to check that a DMN file is portable.
 *
 * <p>When both engines fail, they agree (the document or the inputs are wrong for both). When only one fails, that is
 * a difference.
 */
public final class DmnCrossCheck {

    /**
     * The outcome of one cross-check.
     *
     * @param primaryEngine   name of the first engine
     * @param secondaryEngine name of the second engine
     * @param primary         the first engine's evaluation, or {@code null} when it failed
     * @param secondary       the second engine's evaluation, or {@code null} when it failed
     * @param differences     human readable differences; empty when the engines agree
     */
    public record Result(String primaryEngine, String secondaryEngine, DmnEvaluation primary, DmnEvaluation secondary,
                         List<String> differences) {

        /** Makes the differences unmodifiable. */
        public Result {
            differences = List.copyOf(differences);
        }

        /** @return {@code true} when the two engines gave the same rows and matched rules for every decision */
        public boolean agree() {
            return differences.isEmpty();
        }

        /**
         * Fails when the engines disagree.
         *
         * @return this result
         * @throws DmnException listing the differences
         */
        public Result requireAgreement() {
            if (!agree()) {
                throw new DmnException("Operaton and KIE disagree (" + primaryEngine + " vs " + secondaryEngine + "): "
                    + String.join("; ", differences));
            }
            return this;
        }
    }

    private final DmnEvaluator primary;
    private final DmnEvaluator secondary;

    /**
     * Compares two engines.
     *
     * @param primary   the first engine, usually Operaton
     * @param secondary the second engine, usually KIE
     */
    public DmnCrossCheck(DmnEvaluator primary, DmnEvaluator secondary) {
        this.primary = Objects.requireNonNull(primary, "primary");
        this.secondary = Objects.requireNonNull(secondary, "secondary");
    }

    /** Compares Operaton with KIE. */
    public DmnCrossCheck() {
        this(new OperatonDmnEvaluator(), new KieDmnEvaluator());
    }

    /**
     * Evaluates and compares.
     *
     * @param dmn         the DMN document
     * @param decisionRef a decision id, or {@code null} for the sink decision
     * @param inputs      the input variables
     * @return the comparison
     */
    public Result check(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
        List<String> differences = new ArrayList<>();
        DmnEvaluation first = run(primary, dmn, decisionRef, inputs, differences);
        DmnEvaluation second = run(secondary, dmn, decisionRef, inputs, differences);
        if (first != null && second != null) {
            compare(first, second, differences);
        } else if (first != null || second != null) {
            // one failed: the failure message is already in the list
            differences.add((first == null ? primary : secondary).engineName() + " failed while "
                + (first == null ? secondary : primary).engineName() + " returned a result");
        } else {
            differences.clear();
        }
        return new Result(primary.engineName(), secondary.engineName(), first, second, differences);
    }

    private static DmnEvaluation run(DmnEvaluator engine, DmnResource dmn, String ref, Map<String, Object> inputs, List<String> differences) {
        try {
            return engine.evaluate(dmn, ref, inputs);
        } catch (DmnException e) {
            differences.add(engine.engineName() + " failed: " + e.getMessage());
            return null;
        }
    }

    private void compare(DmnEvaluation first, DmnEvaluation second, List<String> differences) {
        List<String> firstIds = first.decisions().stream().map(DecisionEvaluation::decisionId).toList();
        List<String> secondIds = second.decisions().stream().map(DecisionEvaluation::decisionId).toList();
        if (!firstIds.equals(secondIds)) {
            differences.add("evaluated decisions differ: " + firstIds + " vs " + secondIds);
            return;
        }
        for (DecisionEvaluation a : first.decisions()) {
            DecisionEvaluation b = second.decision(a.decisionId());
            if (!sameRows(a.rows(), b.rows())) {
                differences.add("decision '" + a.decisionId() + "' rows differ: " + a.rows() + " vs " + b.rows());
            }
            if (!a.matchedRules().equals(b.matchedRules())) {
                differences.add("decision '" + a.decisionId() + "' matched rules differ: " + a.matchedRules() + " vs " + b.matchedRules());
            }
            if (a.matched() != b.matched()) {
                differences.add("decision '" + a.decisionId() + "' matched differs: " + a.matched() + " vs " + b.matched());
            }
        }
    }

    private static boolean sameRows(List<Map<String, Object>> a, List<Map<String, Object>> b) {
        if (a.size() != b.size()) {
            return false;
        }
        for (int i = 0; i < a.size(); i++) {
            if (!sameValue(a.get(i), b.get(i))) {
                return false;
            }
        }
        return true;
    }

    private static boolean sameValue(Object a, Object b) {
        if (a instanceof Number x && b instanceof Number y) {
            return new BigDecimal(x.toString()).compareTo(new BigDecimal(y.toString())) == 0;
        }
        if (a instanceof Map<?, ?> x && b instanceof Map<?, ?> y) {
            if (!x.keySet().equals(y.keySet())) {
                return false;
            }
            return x.keySet().stream().allMatch(k -> sameValue(x.get(k), y.get(k)));
        }
        if (a instanceof List<?> x && b instanceof List<?> y) {
            if (x.size() != y.size()) {
                return false;
            }
            for (int i = 0; i < x.size(); i++) {
                if (!sameValue(x.get(i), y.get(i))) {
                    return false;
                }
            }
            return true;
        }
        return Objects.equals(a, b);
    }
}
