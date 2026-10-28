package io.github.kleash.activiti.scenario.run;

import java.time.Duration;
import java.time.Instant;
import java.time.Period;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** ISO-8601 durations with calendar parts ({@code P1Y2M3DT4H}), applied in UTC. */
final class Durations {

    private static final Pattern ISO = Pattern.compile(
            "^([-+])?P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)W)?(?:(\\d+)D)?(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+(?:\\.\\d+)?)S)?)?$");

    private Durations() {
    }

    static Instant plus(Instant base, String iso) {
        Matcher m = ISO.matcher(iso);
        if (!m.matches()) {
            throw new IllegalArgumentException("'" + iso + "' is not an ISO-8601 duration such as PT25H, P1D or P1Y2M3DT4H");
        }
        Period period = Period.of(num(m.group(2)), num(m.group(3)), num(m.group(4)) * 7 + num(m.group(5)));
        Duration time = Duration.ofHours(num(m.group(6))).plusMinutes(num(m.group(7)));
        if (m.group(8) != null) {
            time = time.plusMillis(Math.round(Double.parseDouble(m.group(8)) * 1000));
        }
        ZonedDateTime at = base.atZone(ZoneOffset.UTC);
        boolean negative = "-".equals(m.group(1));
        return (negative ? at.minus(period).minus(time) : at.plus(period).plus(time)).toInstant();
    }

    private static int num(String s) {
        return s == null ? 0 : Integer.parseInt(s);
    }
}
