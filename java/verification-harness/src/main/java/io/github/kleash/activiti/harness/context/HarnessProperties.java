package io.github.kleash.activiti.harness.context;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.TreeSet;

/**
 * The optional hand-written {@code harness.properties} of a project: Spring properties merged into that project's
 * application context, overriding the harness defaults. This is how a project selects the DMN engine
 * ({@code activiti.dmn.engine=kie}) or sets any other property of its context.
 *
 * <p>The properties that make the harness work - the in-memory database of the project, the mandatory engine settings
 * of ADR 0005 (docs/adr/0005-scenario-format.md), the deployment location and the job driving mode - belong to the harness; a file that sets one of them is
 * rejected with a message that names the key, instead of being silently ignored or silently breaking isolation.
 */
public final class HarnessProperties {

    /** Properties a project must not set (exact keys and the prefixes ending in a dot). */
    private static final List<String> RESERVED = List.of(
            "spring.datasource.", "spring.jmx.enabled", "spring.application.name",
            "spring.activiti.history-level", "spring.activiti.db-history-used", "spring.activiti.deployment-mode",
            "spring.activiti.process-definition-location-prefix", "spring.activiti.process-definition-location-suffixes",
            "spring.activiti.check-process-definitions", "spring.activiti.async-executor-activate", "activiti.connectors.dir");

    private HarnessProperties() {
    }

    /**
     * Reads a project's {@code harness.properties}.
     *
     * @param file the file, or {@code null} for a project that has none
     * @return the properties in file order; empty without a file
     * @throws IllegalStateException when the file cannot be read or sets a property the harness owns
     */
    public static Map<String, String> load(Path file) {
        if (file == null) {
            return Map.of();
        }
        Properties raw = new Properties();
        try (InputStream in = Files.newInputStream(file)) {
            raw.load(in);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + file, e);
        }
        TreeSet<String> keys = new TreeSet<>(raw.stringPropertyNames());
        List<String> reserved = keys.stream().filter(HarnessProperties::isReserved).toList();
        if (!reserved.isEmpty()) {
            throw new IllegalStateException(file + " sets " + reserved + ", which the harness owns (database isolation, the mandatory engine "
                    + "settings, deployment location and job driving). Remove them; every other Spring property is allowed.");
        }
        Map<String, String> result = new LinkedHashMap<>();
        keys.forEach(k -> result.put(k, raw.getProperty(k).trim()));
        return Collections.unmodifiableMap(result);
    }

    private static boolean isReserved(String key) {
        return RESERVED.stream().anyMatch(r -> r.endsWith(".") ? key.startsWith(r) : key.equals(r));
    }
}
