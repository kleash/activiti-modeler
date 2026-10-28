package io.github.kleash.activiti.dmn;

import java.util.Map;

/**
 * SPI of a DMN evaluation engine. Implementations: Operaton (default, in this module) and KIE
 * (module {@code activiti-dmn-connector-kie}). Selected by the property {@code activiti.dmn.engine}.
 *
 * <p>Implementations are thread safe and cache the parsed model per {@link DmnResource#contentHash()}.
 */
public interface DmnEvaluator {

    /**
     * Evaluates a decision, together with every decision it requires.
     *
     * @param dmn         the DMN document
     * @param decisionRef the id of the decision to evaluate; {@code null} selects the document's sink decision
     * @param inputs      the input variables (already stripped of {@code _activiti_*} constants)
     * @return the result rows, matched rule ids and per-decision results
     * @throws DmnModelException      when the document is invalid or uses constructs this engine cannot execute
     * @throws DmnResolutionException when {@code decisionRef} does not select exactly one decision
     * @throws DmnException           when evaluation fails (for example two UNIQUE rules matched)
     */
    DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs);

    /**
     * Checks that the document can be read and that this engine can run every decision in it, without evaluating anything. The
     * default only parses the document structure ({@link DmnModel#parse}); engines override it to also compile the decisions.
     *
     * @param dmn the DMN document
     * @throws DmnModelException when the document is invalid or uses constructs this engine cannot execute
     */
    default void validate(DmnResource dmn) {
        DmnModel.parse(dmn.xml());
    }

    /** @return the engine name as accepted by {@code activiti.dmn.engine}, for example {@code operaton} */
    String engineName();
}
