package io.github.kleash.activiti.scenario.match;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

class ValueMatcherTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Parses JSON into the plain Java values the loader produces. */
    private static Object json(String text) {
        try {
            return JSON.readValue(text, Object.class);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private static List<String> match(String expected, Object actual) {
        return ValueMatcher.match("v", json(expected), actual);
    }

    // ---- literals -----------------------------------------------------------------------------------------------------

    @Test
    void literalsMatchByEquality() {
        assertThat(match("\"low\"", "low")).isEmpty();
        assertThat(match("true", true)).isEmpty();
        assertThat(match("null", null)).isEmpty();
        assertThat(match("[1, \"a\"]", List.of(1, "a"))).isEmpty();
        assertThat(match("{\"a\": {\"b\": 1}}", Map.of("a", Map.of("b", 1)))).isEmpty();
    }

    @Test
    void literalMismatchesSayWhatWasExpectedAndFound() {
        assertThat(match("\"low\"", "high")).containsExactly("v: expected \"low\" but was \"high\"");
        assertThat(match("null", "x")).containsExactly("v: expected null but was \"x\"");
        assertThat(match("true", "true")).containsExactly("v: expected true but was \"true\"");
    }

    @Test
    void numbersCompareByValueNotByBoxedType() {
        assertThat(match("5000", 5000L)).isEmpty();
        assertThat(match("5000", new BigDecimal("5000.00"))).isEmpty();
        assertThat(match("5000", 5000.0d)).isEmpty();
        assertThat(match("0.1", new BigDecimal("0.10"))).isEmpty();
        assertThat(match("5000", 5001)).containsExactly("v: expected 5000 but was 5001");
    }

    @Test
    void datesCompareByInstant() {
        Date date = Date.from(Instant.parse("2030-01-02T09:00:00Z"));
        assertThat(match("\"2030-01-02T09:00:00Z\"", date)).isEmpty();
        assertThat(match("\"2030-01-02T10:00:00+01:00\"", date)).isEmpty();
        assertThat(match("\"2030-01-02T09:00:01Z\"", date)).hasSize(1);
        assertThat(match("\"2030-01-02T09:00:00Z\"", Instant.parse("2030-01-02T09:00:00Z"))).isEmpty();
    }

    @Test
    void objectsAreComparedKeyByKeyWithAnExactKeySet() {
        assertThat(match("{\"a\": 1}", Map.of("a", 1, "b", 2))).containsExactly("v: unexpected entry [b]");
        assertThat(match("{\"a\": 1, \"b\": 2}", Map.of("a", 1))).containsExactly("v.b: expected 2 but the value is missing");
        assertThat(match("{\"a\": {\"b\": 1}}", Map.of("a", Map.of("b", 2)))).containsExactly("v.a.b: expected 1 but was 2");
    }

    @Test
    void arraysAreComparedElementByElement() {
        assertThat(match("[1, 2]", List.of(1))).hasSize(1).first().asString().contains("expected 2 element(s)");
        assertThat(match("[1, 2]", List.of(1, 3))).containsExactly("v[1]: expected 2 but was 3");
    }

    @Test
    void jsonNodesAndArraysAreNormalized() throws Exception {
        assertThat(ValueMatcher.matches(json("{\"a\": [1, 2]}"), JSON.readTree("{\"a\": [1, 2]}"))).isTrue();
        assertThat(ValueMatcher.matches(json("[\"x\"]"), new String[] {"x"})).isTrue();
    }

    // ---- operators ----------------------------------------------------------------------------------------------------

    @Test
    void existsChecksPresenceOfAKey() {
        Map<String, Object> actual = new LinkedHashMap<>();
        actual.put("present", null);
        Map<String, Object> expected = (Map<String, Object>) json("{\"present\": {\"$exists\": true}, \"gone\": {\"$exists\": false}}");
        assertThat(ValueMatcher.matchMap("variables", expected, actual, true)).isEmpty();

        assertThat(ValueMatcher.matchMap("variables", (Map<String, Object>) json("{\"gone\": {\"$exists\": true}}"), actual, true))
                .containsExactly("variables.gone: expected {\"$exists\":true} but the value is missing");
        assertThat(ValueMatcher.matchMap("variables", (Map<String, Object>) json("{\"present\": {\"$exists\": false}}"), actual, true))
                .containsExactly("variables.present: expected the value to be absent but was null");
    }

    @Test
    void typeChecksTheKindOfValue() {
        assertThat(match("{\"$type\": \"string\"}", "x")).isEmpty();
        assertThat(match("{\"$type\": \"number\"}", 1.5)).isEmpty();
        assertThat(match("{\"$type\": \"integer\"}", 7)).isEmpty();
        assertThat(match("{\"$type\": \"integer\"}", new BigDecimal("7.0"))).isEmpty();
        assertThat(match("{\"$type\": \"integer\"}", 7.5)).hasSize(1);
        assertThat(match("{\"$type\": \"boolean\"}", false)).isEmpty();
        assertThat(match("{\"$type\": \"array\"}", List.of())).isEmpty();
        assertThat(match("{\"$type\": \"object\"}", Map.of())).isEmpty();
        assertThat(match("{\"$type\": \"null\"}", null)).isEmpty();
        assertThat(match("{\"$type\": \"date\"}", new Date())).isEmpty();
        assertThat(match("{\"$type\": \"date\"}", "2030-01-01T00:00:00Z")).isEmpty();
        assertThat(match("{\"$type\": \"date\"}", "yesterday")).hasSize(1);
        assertThat(match("{\"$type\": \"string\"}", 1)).containsExactly("v: expected type string but was 1 (Integer)");
    }

    @Test
    void regexMatchesAnywhereUnlessAnchored() {
        assertThat(match("{\"$regex\": \"^L-\\\\d+$\"}", "L-42")).isEmpty();
        assertThat(match("{\"$regex\": \"-4\"}", "L-42")).isEmpty();
        assertThat(match("{\"$regex\": \"^-4\"}", "L-42")).containsExactly("v: expected a value matching /^-4/ but was \"L-42\"");
        assertThat(match("{\"$regex\": \"1\"}", 123)).isEmpty();
        assertThat(match("{\"$regex\": \"(\"}", "x")).hasSize(1).first().asString().contains("invalid $regex");
    }

    @Test
    void comparisonOperatorsOrderNumbersAndDates() {
        assertThat(match("{\"$gt\": 10}", 11)).isEmpty();
        assertThat(match("{\"$gt\": 10}", 10)).containsExactly("v: expected a value greater than 10 but was 10");
        assertThat(match("{\"$gte\": 10}", 10)).isEmpty();
        assertThat(match("{\"$lt\": 10}", 9.5)).isEmpty();
        assertThat(match("{\"$lte\": 10}", new BigDecimal("10.0"))).isEmpty();
        assertThat(match("{\"$lte\": 10}", 11)).containsExactly("v: expected a value less than or equal to 10 but was 11");
        assertThat(match("{\"$gt\": 1, \"$lt\": 5}", 3)).isEmpty();
        assertThat(match("{\"$gt\": 1, \"$lt\": 5}", 7)).hasSize(1);
        assertThat(match("{\"$lt\": \"2030-01-01T00:00:00Z\"}", Date.from(Instant.parse("2029-12-31T23:59:59Z")))).isEmpty();
        assertThat(match("{\"$gt\": 1}", "text")).containsExactly("v: cannot compare \"text\" with 1 using $gt");
    }

    @Test
    void containsWorksOnStringsArraysAndObjects() {
        assertThat(match("{\"$contains\": \"boom\"}", "it went boom")).isEmpty();
        assertThat(match("{\"$contains\": \"bang\"}", "it went boom")).hasSize(1);
        assertThat(match("{\"$contains\": 2}", List.of(1, 2, 3))).isEmpty();
        assertThat(match("{\"$contains\": {\"$gt\": 2}}", List.of(1, 2, 3))).isEmpty();
        assertThat(match("{\"$contains\": 9}", List.of(1, 2, 3))).containsExactly("v: expected an array containing 9 but was [1,2,3]");
        assertThat(match("{\"$contains\": {\"a\": 1}}", Map.of("a", 1, "b", 2))).isEmpty();
        assertThat(match("{\"$contains\": 1}", 5)).hasSize(1);
    }

    @Test
    void sizeAcceptsANumberOrAMatcher() {
        assertThat(match("{\"$size\": 3}", List.of(1, 2, 3))).isEmpty();
        assertThat(match("{\"$size\": 2}", List.of(1, 2, 3))).containsExactly("v.size: expected 2 but was 3");
        assertThat(match("{\"$size\": {\"$gte\": 2}}", Map.of("a", 1, "b", 2))).isEmpty();
        assertThat(match("{\"$size\": 4}", "four")).isEmpty();
        assertThat(match("{\"$size\": 1}", 7)).hasSize(1);
    }

    @Test
    void anyAcceptsAlternativesThatAreLiteralsOrMatchers() {
        assertThat(match("{\"$any\": [\"a\", \"b\"]}", "b")).isEmpty();
        assertThat(match("{\"$any\": [\"a\", {\"$regex\": \"^x\"}]}", "xyz")).isEmpty();
        assertThat(match("{\"$any\": [\"a\", \"b\"]}", "c")).containsExactly("v: expected any of [\"a\",\"b\"] but was \"c\"");
    }

    @Test
    void ignoreRequiresPresenceOnly() {
        Map<String, Object> actual = Map.of("a", 1);
        assertThat(ValueMatcher.matchMap("m", (Map<String, Object>) json("{\"a\": {\"$ignore\": true}}"), actual, false)).isEmpty();
        assertThat(ValueMatcher.matchMap("m", (Map<String, Object>) json("{\"b\": {\"$ignore\": true}}"), actual, true))
                .containsExactly("m.b: expected {\"$ignore\":true} but the value is missing");
    }

    @Test
    void operatorsNestInsideObjectsAndArrays() {
        Object expected = json("{\"user\": {\"name\": {\"$regex\": \"^A\"}, \"tags\": [{\"$any\": [\"x\", \"y\"]}]}}");
        assertThat(ValueMatcher.match("v", expected, Map.of("user", Map.of("name", "Ann", "tags", List.of("y"))))).isEmpty();
        assertThat(ValueMatcher.match("v", expected, Map.of("user", Map.of("name", "Bob", "tags", List.of("y")))))
                .containsExactly("v.user.name: expected a value matching /^A/ but was \"Bob\"");
    }

    // ---- maps ---------------------------------------------------------------------------------------------------------

    @Test
    void partialMapMatchingIgnoresUnlistedEntries() {
        Map<String, Object> expected = Map.of("a", 1);
        Map<String, Object> actual = Map.of("a", 1, "b", 2);
        assertThat(ValueMatcher.matchMap("variables", expected, actual, true)).isEmpty();
        assertThat(ValueMatcher.matchMap("variables", expected, actual, false))
                .containsExactly("variables: unexpected entry [b] (list them, or mark the check partial); actual keys are [a, b]");
    }

    @Test
    void isMatcherRecognisesDollarObjectsOnly() {
        assertThat(ValueMatcher.isMatcher(json("{\"$gt\": 1}"))).isTrue();
        assertThat(ValueMatcher.isMatcher(json("{\"a\": 1}"))).isFalse();
        assertThat(ValueMatcher.isMatcher(json("{}"))).isFalse();
        assertThat(ValueMatcher.isMatcher("x")).isFalse();
    }

    @Test
    void longValuesAreTruncatedInMessages() {
        String longText = "x".repeat(1000);
        assertThat(match("\"short\"", longText).get(0)).contains("...(1002 chars)");
    }
}
