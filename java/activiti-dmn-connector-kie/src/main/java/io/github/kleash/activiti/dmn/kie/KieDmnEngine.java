package io.github.kleash.activiti.dmn.kie;

/**
 * Identifies the KIE DMN engine in cross-check results. The evaluator is {@link KieDmnEvaluator}; the property value
 * that selects it is {@link KieDmnEvaluator#NAME}.
 */
public final class KieDmnEngine {

    /** Engine name as reported in cross-check results. */
    public static final String NAME = "kie-dmn";

    private KieDmnEngine() {
    }
}
