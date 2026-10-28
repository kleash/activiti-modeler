package io.github.kleash.activiti.rest.core.service;

import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Conversions from engine values to what the DTOs carry. */
public final class Values {

    private Values() {
    }

    static Instant instant(Date date) {
        return date == null ? null : date.toInstant();
    }

    /**
     * A variable value as JSON-friendly data. The API never exposes engine entities or arbitrary classes: JSON nodes, scalars,
     * collections and maps pass through, dates become ISO text, byte arrays are described, and any other object is converted
     * with Jackson or, if that fails, shown as text.
     */
    static Object json(ObjectMapper mapper, Object value) {
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean || value instanceof JsonNode) {
            return value;
        }
        if (value instanceof Date date) {
            return date.toInstant().toString();
        }
        if (value instanceof byte[] bytes) {
            return "[" + bytes.length + " bytes]";
        }
        try {
            return mapper.convertValue(value, Object.class);
        } catch (IllegalArgumentException e) {
            return String.valueOf(value);
        }
    }

    static Map<String, Object> json(ObjectMapper mapper, Map<String, Object> values) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (values != null) {
            values.forEach((k, v) -> out.put(k, json(mapper, v)));
        }
        return out;
    }

    /** A modifiable copy of {@code values}, empty for {@code null}. */
    public static Map<String, Object> nonNull(Map<String, Object> values) {
        return values == null ? new LinkedHashMap<>() : new LinkedHashMap<>(values);
    }
}
