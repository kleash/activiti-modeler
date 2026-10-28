package io.github.kleash.activiti.harness.n01;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Registry of the checks the engine oracle ({@code expected-engine.json}) refers to by id. The checks themselves are grouped by
 * what they observe: {@link FlowChecks} (constructs the engine drops or replaces), {@link EventChecks} (events, signals, timers,
 * messages), {@link FailureChecks} (what throws at run time), {@link DataChecks} (extensions mappings, connectors, decisions,
 * variables) and {@link FixedChecks} (the models the quick fixes lead to).
 */
final class N01Checks {

    private N01Checks() {
    }

    static Map<String, N01Check> all() {
        Map<String, N01Check> checks = new LinkedHashMap<>();
        FlowChecks.register(checks);
        EventChecks.register(checks);
        FailureChecks.register(checks);
        DataChecks.register(checks);
        FixedChecks.register(checks);
        return checks;
    }

    /** Registers a check; an id used twice is a bug of the test, not something to overwrite. */
    static void put(Map<String, N01Check> checks, String id, N01Check check) {
        if (checks.putIfAbsent(id, check) != null) {
            throw new IllegalStateException("Check id registered twice: " + id);
        }
    }
}
