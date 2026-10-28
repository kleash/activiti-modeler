package io.github.kleash.activiti.scenario.match;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.time.temporal.Temporal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;

/**
 * The value language of scenario assertions (docs/user-guide/scenarios.md, "Matchers").
 *
 * <ul>
 *   <li>A literal means <em>equals</em>. Numbers compare by value ({@code 5000} equals an {@code Integer},
 *       {@code Long}, {@code BigDecimal} or {@code Double} 5000); a date expected as an ISO string equals a
 *       {@link Date} or {@link Temporal} of the same instant.</li>
 *   <li>An object whose keys all start with {@code $} is a matcher: {@code $exists}, {@code $type},
 *       {@code $regex}, {@code $gt}, {@code $gte}, {@code $lt}, {@code $lte}, {@code $contains}, {@code $size},
 *       {@code $any}, {@code $ignore}. All operators present must hold.</li>
 *   <li>Any other object is compared key by key with the exact key set; arrays element by element.</li>
 * </ul>
 *
 * All methods return human readable mismatch messages of the form {@code <path>: expected X but was Y}; an empty list
 * means the value matches.
 */
public final class ValueMatcher {

    /** Marks "no such key" when matching a missing entry of a map. */
    public static final Object ABSENT = new Object() {
        @Override public String toString() { return "<absent>"; }
    };

    private static final ObjectMapper JSON = JsonMapper.builder().disable(SerializationFeature.FAIL_ON_EMPTY_BEANS).build();
    private static final int MAX_SHOWN = 240;

    private ValueMatcher() {
    }

    /** @return {@code true} when {@code expected} is a non-empty map whose keys all start with {@code $}. */
    public static boolean isMatcher(Object expected) {
        return expected instanceof Map<?, ?> m && !m.isEmpty()
                && m.keySet().stream().allMatch(k -> k instanceof String s && s.startsWith("$"));
    }

    /** Matches one value; {@code path} prefixes the messages. {@code actual} may be {@link #ABSENT}. */
    public static List<String> match(String path, Object expected, Object actual) {
        List<String> out = new ArrayList<>();
        check(path, expected, normalize(actual), out);
        return out;
    }

    /** Convenience: {@code true} when {@link #match} reports nothing. */
    public static boolean matches(Object expected, Object actual) {
        return match("value", expected, actual).isEmpty();
    }

    /**
     * Matches a map of values.
     *
     * @param partial {@code true}: only the expected keys are checked; {@code false}: the actual map must have
     *                exactly the expected keys
     */
    public static List<String> matchMap(String path, Map<String, Object> expected, Map<String, ?> actual, boolean partial) {
        List<String> out = new ArrayList<>();
        Map<String, Object> normalized = new LinkedHashMap<>();
        actual.forEach((k, v) -> normalized.put(k, normalize(v)));
        for (Map.Entry<String, Object> e : expected.entrySet()) {
            Object value = normalized.containsKey(e.getKey()) ? normalized.get(e.getKey()) : ABSENT;
            check(join(path, e.getKey()), e.getValue(), value, out);
        }
        if (!partial) {
            TreeSet<String> extra = new TreeSet<>(normalized.keySet());
            extra.removeAll(expected.keySet());
            if (!extra.isEmpty()) {
                out.add(path + ": unexpected " + (extra.size() == 1 ? "entry " : "entries ") + extra
                        + " (list them, or mark the check partial); actual keys are " + new TreeSet<>(normalized.keySet()));
            }
        }
        return out;
    }

    // ---- core -------------------------------------------------------------------------------------------------------

    private static void check(String path, Object expected, Object actual, List<String> out) {
        if (isMatcher(expected)) {
            checkOperators(path, castMap(expected), actual, out);
            return;
        }
        if (actual == ABSENT) {
            out.add(path + ": expected " + show(expected) + " but the value is missing");
            return;
        }
        if (expected instanceof Map<?, ?> em) {
            if (!(actual instanceof Map<?, ?> am)) {
                out.add(path + ": expected an object " + show(expected) + " but was " + show(actual));
                return;
            }
            Map<String, Object> expectedMap = castMap(em);
            Map<String, Object> actualMap = castMap(am);
            for (Map.Entry<String, Object> e : expectedMap.entrySet()) {
                check(join(path, e.getKey()), e.getValue(), actualMap.containsKey(e.getKey()) ? actualMap.get(e.getKey()) : ABSENT, out);
            }
            TreeSet<String> extra = new TreeSet<>(actualMap.keySet());
            extra.removeAll(expectedMap.keySet());
            if (!extra.isEmpty()) {
                out.add(path + ": unexpected " + (extra.size() == 1 ? "entry " : "entries ") + extra);
            }
            return;
        }
        if (expected instanceof List<?> el) {
            if (!(actual instanceof List<?> al)) {
                out.add(path + ": expected an array " + show(expected) + " but was " + show(actual));
                return;
            }
            if (el.size() != al.size()) {
                out.add(path + ": expected " + el.size() + " element(s) " + show(expected) + " but was " + al.size() + " element(s) " + show(actual));
                return;
            }
            for (int i = 0; i < el.size(); i++) {
                check(path + "[" + i + "]", el.get(i), al.get(i), out);
            }
            return;
        }
        if (!literalEquals(expected, actual)) {
            out.add(path + ": expected " + show(expected) + " but was " + show(actual));
        }
    }

    private static void checkOperators(String path, Map<String, Object> ops, Object actual, List<String> out) {
        if (actual == ABSENT) {
            Object exists = ops.get("$exists");
            if (!(exists instanceof Boolean b && !b)) {
                out.add(path + ": expected " + show(ops) + " but the value is missing");
            }
            return;
        }
        for (Map.Entry<String, Object> op : ops.entrySet()) {
            Object arg = op.getValue();
            switch (op.getKey()) {
                case "$exists" -> {
                    if (Boolean.FALSE.equals(arg)) {
                        out.add(path + ": expected the value to be absent but was " + show(actual));
                    }
                }
                case "$ignore" -> { /* present is all that is required */ }
                case "$type" -> {
                    if (!hasType(String.valueOf(arg), actual)) {
                        out.add(path + ": expected type " + arg + " but was " + show(actual) + " (" + typeName(actual) + ")");
                    }
                }
                case "$regex" -> checkRegex(path, String.valueOf(arg), actual, out);
                case "$gt", "$gte", "$lt", "$lte" -> checkComparison(path, op.getKey(), arg, actual, out);
                case "$contains" -> checkContains(path, arg, actual, out);
                case "$size" -> checkSize(path, arg, actual, out);
                case "$any" -> checkAny(path, arg, actual, out);
                default -> out.add(path + ": unknown matcher operator " + op.getKey());
            }
        }
    }

    private static void checkRegex(String path, String regex, Object actual, List<String> out) {
        if (actual == null) {
            out.add(path + ": expected a value matching /" + regex + "/ but was null");
            return;
        }
        try {
            if (!Pattern.compile(regex).matcher(textOf(actual)).find()) {
                out.add(path + ": expected a value matching /" + regex + "/ but was " + show(actual));
            }
        } catch (PatternSyntaxException e) {
            out.add(path + ": invalid $regex /" + regex + "/: " + e.getDescription());
        }
    }

    private static void checkComparison(String path, String op, Object bound, Object actual, List<String> out) {
        Integer cmp = compare(actual, bound);
        if (cmp == null) {
            out.add(path + ": cannot compare " + show(actual) + " with " + show(bound) + " using " + op);
            return;
        }
        boolean ok = switch (op) {
            case "$gt" -> cmp > 0;
            case "$gte" -> cmp >= 0;
            case "$lt" -> cmp < 0;
            default -> cmp <= 0;
        };
        if (!ok) {
            String words = switch (op) {
                case "$gt" -> "greater than";
                case "$gte" -> "greater than or equal to";
                case "$lt" -> "less than";
                default -> "less than or equal to";
            };
            out.add(path + ": expected a value " + words + " " + show(bound) + " but was " + show(actual));
        }
    }

    private static void checkContains(String path, Object needle, Object actual, List<String> out) {
        if (actual instanceof String s) {
            if (!s.contains(String.valueOf(needle))) {
                out.add(path + ": expected text containing " + show(needle) + " but was " + show(actual));
            }
        } else if (actual instanceof List<?> list) {
            boolean found = list.stream().anyMatch(item -> matches(needle, item));
            if (!found) {
                out.add(path + ": expected an array containing " + show(needle) + " but was " + show(actual));
            }
        } else if (actual instanceof Map<?, ?> map && needle instanceof Map<?, ?> nm) {
            Map<String, Object> actualMap = castMap(map);
            for (Map.Entry<String, Object> e : castMap(nm).entrySet()) {
                check(join(path, e.getKey()), e.getValue(), actualMap.containsKey(e.getKey()) ? actualMap.get(e.getKey()) : ABSENT, out);
            }
        } else {
            out.add(path + ": $contains needs a string, array or object value but was " + show(actual));
        }
    }

    private static void checkSize(String path, Object expectedSize, Object actual, List<String> out) {
        Integer size = actual instanceof Collection<?> c ? c.size()
                : actual instanceof Map<?, ?> m ? m.size()
                : actual instanceof String s ? s.length() : null;
        if (size == null) {
            out.add(path + ": $size needs an array, object or string value but was " + show(actual));
            return;
        }
        List<String> inner = new ArrayList<>();
        check(path + ".size", expectedSize, size, inner);
        out.addAll(inner);
    }

    private static void checkAny(String path, Object alternatives, Object actual, List<String> out) {
        if (!(alternatives instanceof List<?> list)) {
            out.add(path + ": $any needs an array of alternatives");
            return;
        }
        for (Object alternative : list) {
            if (match(path, alternative, actual).isEmpty()) {
                return;
            }
        }
        out.add(path + ": expected any of " + show(alternatives) + " but was " + show(actual));
    }

    // ---- types, equality, comparison --------------------------------------------------------------------------------

    private static boolean hasType(String type, Object actual) {
        return switch (type) {
            case "string" -> actual instanceof String;
            case "number" -> actual instanceof Number;
            case "integer" -> isInteger(actual);
            case "boolean" -> actual instanceof Boolean;
            case "array" -> actual instanceof List<?>;
            case "object" -> actual instanceof Map<?, ?>;
            case "null" -> actual == null;
            case "date" -> toInstant(actual) != null && !(actual instanceof String s && isNumeric(s));
            default -> false;
        };
    }

    private static boolean isInteger(Object actual) {
        return actual instanceof Integer || actual instanceof Long || actual instanceof Short || actual instanceof Byte
                || actual instanceof BigInteger
                || (actual instanceof BigDecimal bd && bd.stripTrailingZeros().scale() <= 0);
    }

    private static boolean isNumeric(String s) {
        return !s.isEmpty() && s.chars().allMatch(Character::isDigit);
    }

    private static String typeName(Object actual) {
        if (actual == null) {
            return "null";
        }
        if (actual instanceof Map<?, ?>) {
            return "object";
        }
        if (actual instanceof List<?>) {
            return "array";
        }
        return actual.getClass().getSimpleName();
    }

    private static boolean literalEquals(Object expected, Object actual) {
        if (expected == null || actual == null) {
            return expected == null && actual == null;
        }
        if (expected instanceof Number en && actual instanceof Number an) {
            BigDecimal e = decimal(en);
            BigDecimal a = decimal(an);
            return e != null && a != null ? e.compareTo(a) == 0 : en.doubleValue() == an.doubleValue();
        }
        if (expected instanceof String es && !(actual instanceof String)) {
            Instant actualInstant = toInstantStrict(actual);
            Instant expectedInstant = actualInstant == null ? null : toInstant(es);
            if (actualInstant != null && expectedInstant != null) {
                return actualInstant.equals(expectedInstant);
            }
        }
        if (expected instanceof String es && actual instanceof String as && !es.equals(as)) {
            return false;
        }
        return Objects.equals(expected, actual);
    }

    /** @return negative, zero or positive; {@code null} when the operands cannot be ordered. */
    private static Integer compare(Object actual, Object bound) {
        if (actual instanceof Number an && bound instanceof Number bn) {
            BigDecimal a = decimal(an);
            BigDecimal b = decimal(bn);
            return a != null && b != null ? a.compareTo(b) : Double.compare(an.doubleValue(), bn.doubleValue());
        }
        Instant a = toInstant(actual);
        Instant b = toInstant(bound);
        if (a != null && b != null && !(actual instanceof Number) && !(bound instanceof Number)) {
            return a.compareTo(b);
        }
        return null;
    }

    private static BigDecimal decimal(Number n) {
        try {
            if (n instanceof BigDecimal bd) {
                return bd;
            }
            if (n instanceof BigInteger bi) {
                return new BigDecimal(bi);
            }
            if (n instanceof Double || n instanceof Float) {
                double d = n.doubleValue();
                return Double.isNaN(d) || Double.isInfinite(d) ? null : BigDecimal.valueOf(d);
            }
            return BigDecimal.valueOf(n.longValue());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Date, Instant, Temporal or ISO string to an instant; {@code null} when not a point in time. */
    private static Instant toInstant(Object value) {
        if (value instanceof String s) {
            return parseInstant(s);
        }
        return toInstantStrict(value);
    }

    private static Instant toInstantStrict(Object value) {
        if (value instanceof Date d) {
            return d.toInstant();
        }
        if (value instanceof Instant i) {
            return i;
        }
        if (value instanceof OffsetDateTime o) {
            return o.toInstant();
        }
        if (value instanceof ZonedDateTime z) {
            return z.toInstant();
        }
        if (value instanceof LocalDateTime l) {
            return l.toInstant(ZoneOffset.UTC);
        }
        return null;
    }

    private static Instant parseInstant(String s) {
        try {
            return OffsetDateTime.parse(s).toInstant();
        } catch (DateTimeParseException e) {
            try {
                return LocalDateTime.parse(s).toInstant(ZoneOffset.UTC);
            } catch (DateTimeParseException e2) {
                return null;
            }
        }
    }

    private static String textOf(Object actual) {
        Instant instant = toInstantStrict(actual);
        return instant != null ? instant.toString() : String.valueOf(actual);
    }

    // ---- normalization and rendering --------------------------------------------------------------------------------

    /**
     * Turns an engine value into plain comparable data: Jackson trees to maps/lists, arrays and collections to lists,
     * maps to maps, enums to their name; dates and numbers stay as they are.
     */
    public static Object normalize(Object value) {
        if (value == null || value == ABSENT || value instanceof String || value instanceof Boolean || value instanceof Number
                || value instanceof Date || value instanceof Temporal) {
            return value;
        }
        if (value instanceof CharSequence cs) {
            return cs.toString();
        }
        if (value instanceof Character c) {
            return c.toString();
        }
        if (value instanceof Enum<?> e) {
            return e.name();
        }
        if (value instanceof JsonNode node) {
            return normalize(JSON.convertValue(node, Object.class));
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> out = new LinkedHashMap<>();
            map.forEach((k, v) -> out.put(String.valueOf(k), normalize(v)));
            return out;
        }
        if (value instanceof Collection<?> c) {
            List<Object> out = new ArrayList<>(c.size());
            c.forEach(v -> out.add(normalize(v)));
            return out;
        }
        if (value.getClass().isArray()) {
            List<Object> out = new ArrayList<>();
            int length = java.lang.reflect.Array.getLength(value);
            for (int i = 0; i < length; i++) {
                out.add(normalize(java.lang.reflect.Array.get(value, i)));
            }
            return out;
        }
        try {
            return normalize(JSON.convertValue(value, Object.class));
        } catch (IllegalArgumentException e) {
            return String.valueOf(value);
        }
    }

    /** Compact JSON-like rendering of a value for messages (long values are truncated). */
    public static String show(Object value) {
        String s;
        if (value == ABSENT) {
            s = "<absent>";
        } else if (value instanceof Date d) {
            s = '"' + d.toInstant().toString() + '"';
        } else if (value instanceof Temporal) {
            s = '"' + value.toString() + '"';
        } else {
            try {
                s = JSON.writeValueAsString(value instanceof Object[] arr ? Arrays.asList(arr) : value);
            } catch (JsonProcessingException e) {
                s = String.valueOf(value);
            }
        }
        return s.length() > MAX_SHOWN ? s.substring(0, MAX_SHOWN) + "...(" + s.length() + " chars)" : s;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object o) {
        return (Map<String, Object>) o;
    }

    private static String join(String path, String key) {
        return path + "." + key;
    }
}
