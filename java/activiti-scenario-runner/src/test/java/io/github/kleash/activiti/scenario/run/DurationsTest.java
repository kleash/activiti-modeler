package io.github.kleash.activiti.scenario.run;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;

import org.junit.jupiter.api.Test;

class DurationsTest {

    private static final Instant BASE = Instant.parse("2030-01-31T09:00:00Z");

    @Test
    void addsTimeParts() {
        assertThat(Durations.plus(BASE, "PT25H")).isEqualTo(Instant.parse("2030-02-01T10:00:00Z"));
        assertThat(Durations.plus(BASE, "PT1H30M15S")).isEqualTo(Instant.parse("2030-01-31T10:30:15Z"));
        assertThat(Durations.plus(BASE, "PT0.5S")).isEqualTo(Instant.parse("2030-01-31T09:00:00.500Z"));
    }

    @Test
    void addsCalendarPartsInUtc() {
        assertThat(Durations.plus(BASE, "P1D")).isEqualTo(Instant.parse("2030-02-01T09:00:00Z"));
        assertThat(Durations.plus(BASE, "P1W")).isEqualTo(Instant.parse("2030-02-07T09:00:00Z"));
        assertThat(Durations.plus(BASE, "P1M")).isEqualTo(Instant.parse("2030-02-28T09:00:00Z"));
        assertThat(Durations.plus(BASE, "P1Y2M3DT4H")).isEqualTo(Instant.parse("2031-04-03T13:00:00Z"));
    }

    @Test
    void negativeDurationsGoBack() {
        assertThat(Durations.plus(BASE, "-PT1H")).isEqualTo(Instant.parse("2030-01-31T08:00:00Z"));
    }

    @Test
    void rejectsText() {
        assertThatThrownBy(() -> Durations.plus(BASE, "25 hours")).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("is not an ISO-8601 duration");
    }
}
