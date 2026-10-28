package io.github.kleash.activiti.dmn;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Value normalisation shared by the evaluators, so that results do not depend on the engine.
 *
 * <p>FEEL has a single number type. Results are therefore normalised to {@link Long} when the number is integral and
 * fits, otherwise {@link Double}. Lists and maps are normalised recursively; every other value is passed through.
 */
public final class DmnValues {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private DmnValues() {
    }

    /**
     * Normalises an engine result value.
     *
     * @param value a value returned by an engine
     * @return the normalised value
     */
    public static Object normalizeResult(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal decimal) {
            return fromBigDecimal(decimal);
        }
        if (value instanceof BigInteger integer) {
            return integer.bitLength() < 64 ? (Object) integer.longValue() : fromBigDecimal(new BigDecimal(integer));
        }
        if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) {
            return ((Number) value).longValue();
        }
        if (value instanceof Double || value instanceof Float) {
            double d = ((Number) value).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                return d;
            }
            return fromBigDecimal(new BigDecimal(value.toString()));
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((k, v) -> copy.put(String.valueOf(k), normalizeResult(v)));
            return copy;
        }
        if (value instanceof Iterable<?> iterable) {
            List<Object> copy = new ArrayList<>();
            iterable.forEach(v -> copy.add(normalizeResult(v)));
            return copy;
        }
        return value;
    }

    /**
     * Prepares a process variable for the engines: Jackson trees (the Activiti {@code json} variable type) become
     * plain maps, lists and scalars; everything else is passed through.
     *
     * @param value a process variable value
     * @return a value the engines can use in FEEL expressions
     */
    public static Object toEngineInput(Object value) {
        if (value instanceof JsonNode node) {
            return MAPPER.convertValue(node, Object.class);
        }
        return value;
    }

    private static Object fromBigDecimal(BigDecimal decimal) {
        BigDecimal stripped = decimal.stripTrailingZeros();
        if (stripped.scale() <= 0) {
            try {
                return stripped.longValueExact();
            } catch (ArithmeticException tooBig) {
                return stripped.doubleValue();
            }
        }
        return stripped.doubleValue();
    }
}
