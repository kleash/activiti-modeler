package io.github.kleash.activiti.dmn;

import java.util.Locale;

/** The COLLECT aggregators of DMN ({@code decisionTable/@aggregation}). */
public enum DmnAggregation {

    /** No aggregation: the result is a list. */
    NONE,
    /** Sum of the matching outputs. */
    SUM,
    /** Smallest matching output. */
    MIN,
    /** Largest matching output. */
    MAX,
    /** Number of matching rules. */
    COUNT;

    /**
     * Parses an {@code aggregation} attribute value.
     *
     * @param value the attribute value, or {@code null} for no aggregation
     * @return the aggregator
     * @throws DmnModelException when the value is unknown
     */
    public static DmnAggregation fromXml(String value) {
        if (value == null || value.isBlank()) {
            return NONE;
        }
        try {
            return valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new DmnModelException("Unknown aggregation '" + value + "'", e);
        }
    }
}
