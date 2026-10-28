package io.github.kleash.activiti.dmn;

import java.util.Locale;

/** The seven DMN 1.3 hit policies, with the spelling used in {@code decisionTable/@hitPolicy}. */
public enum DmnHitPolicy {

    /** At most one rule may match. */
    UNIQUE("UNIQUE"),
    /** The first matching rule in rule order wins. */
    FIRST("FIRST"),
    /** The matching rule with the highest output priority wins (needs {@code outputValues}). */
    PRIORITY("PRIORITY"),
    /** Several rules may match when they all produce the same output. */
    ANY("ANY"),
    /** All matching rules, optionally aggregated (see {@link DmnAggregation}). */
    COLLECT("COLLECT"),
    /** All matching rules in rule order. */
    RULE_ORDER("RULE ORDER"),
    /** All matching rules ordered by output priority (needs {@code outputValues}). */
    OUTPUT_ORDER("OUTPUT ORDER");

    private final String xmlName;

    DmnHitPolicy(String xmlName) {
        this.xmlName = xmlName;
    }

    /** @return the attribute value as written in DMN XML */
    public String xmlName() {
        return xmlName;
    }

    /**
     * Parses a {@code hitPolicy} attribute value.
     *
     * @param value the attribute value, or {@code null} for the default ({@link #UNIQUE})
     * @return the hit policy
     * @throws DmnModelException when the value is not one of the seven hit policies
     */
    public static DmnHitPolicy fromXml(String value) {
        if (value == null || value.isBlank()) {
            return UNIQUE;
        }
        String normalized = value.trim().toUpperCase(Locale.ROOT).replace('_', ' ');
        for (DmnHitPolicy policy : values()) {
            if (policy.xmlName.equals(normalized)) {
                return policy;
            }
        }
        throw new DmnModelException("Unknown hit policy '" + value + "'");
    }

    /** @return {@code true} for the two policies that order by {@code outputValues} (PRIORITY, OUTPUT ORDER) */
    public boolean ordersByOutputValues() {
        return this == PRIORITY || this == OUTPUT_ORDER;
    }
}
