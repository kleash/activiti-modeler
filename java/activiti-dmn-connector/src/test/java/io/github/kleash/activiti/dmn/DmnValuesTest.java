package io.github.kleash.activiti.dmn;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

class DmnValuesTest {

    @Test
    void integralNumbersBecomeLong() {
        assertThat(DmnValues.normalizeResult(5)).isEqualTo(5L);
        assertThat(DmnValues.normalizeResult((short) 5)).isEqualTo(5L);
        assertThat(DmnValues.normalizeResult(new BigDecimal("10.00"))).isEqualTo(10L);
        assertThat(DmnValues.normalizeResult(10.0)).isEqualTo(10L);
        assertThat(DmnValues.normalizeResult(BigInteger.valueOf(7))).isEqualTo(7L);
    }

    @Test
    void fractionsBecomeDouble() {
        assertThat(DmnValues.normalizeResult(new BigDecimal("2.50"))).isEqualTo(2.5);
        assertThat(DmnValues.normalizeResult(0.1f)).isEqualTo(0.1);
        assertThat(DmnValues.normalizeResult(1.25)).isEqualTo(1.25);
    }

    @Test
    void hugeAndSpecialNumbersAreKept() {
        assertThat(DmnValues.normalizeResult(new BigInteger("100000000000000000000"))).isEqualTo(1.0E20);
        assertThat(DmnValues.normalizeResult(new BigDecimal("1E+30"))).isEqualTo(1.0E30);
        assertThat(DmnValues.normalizeResult(Double.POSITIVE_INFINITY)).isEqualTo(Double.POSITIVE_INFINITY);
        assertThat((Double) DmnValues.normalizeResult(Double.NaN)).isNaN();
    }

    @Test
    void nullStringsBooleansAndDatesPassThrough() {
        java.time.LocalDate date = java.time.LocalDate.of(2030, 1, 1);

        assertThat(DmnValues.normalizeResult(null)).isNull();
        assertThat(DmnValues.normalizeResult("x")).isEqualTo("x");
        assertThat(DmnValues.normalizeResult(true)).isEqualTo(true);
        assertThat(DmnValues.normalizeResult(date)).isSameAs(date);
    }

    @Test
    void collectionsAreNormalizedRecursively() {
        Object result = DmnValues.normalizeResult(Map.of("list", List.of(1, new BigDecimal("2.0")), "n", 3));

        assertThat(result).isEqualTo(Map.of("list", List.of(1L, 2L), "n", 3L));
    }

    @Test
    void jacksonTreesBecomePlainJava() throws Exception {
        ObjectMapper mapper = new ObjectMapper();

        assertThat(DmnValues.toEngineInput(mapper.readTree("{\"a\": [1, 2], \"b\": {\"c\": \"d\"}}")))
            .isEqualTo(Map.of("a", List.of(1, 2), "b", Map.of("c", "d")));
        assertThat(DmnValues.toEngineInput(mapper.readTree("42"))).isEqualTo(42);
        assertThat(DmnValues.toEngineInput("plain")).isEqualTo("plain");
        assertThat(DmnValues.toEngineInput(null)).isNull();
    }
}
