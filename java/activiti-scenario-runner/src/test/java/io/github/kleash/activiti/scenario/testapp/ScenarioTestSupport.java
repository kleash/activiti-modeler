package io.github.kleash.activiti.scenario.testapp;

import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;

/** Locates scenario files under {@code src/test/resources/scenarios}. */
public final class ScenarioTestSupport {

    private ScenarioTestSupport() {
    }

    public static Path scenario(String name) {
        URL url = ScenarioTestSupport.class.getResource("/scenarios/" + name);
        if (url == null) {
            throw new IllegalArgumentException("No test scenario file /scenarios/" + name);
        }
        try {
            return Path.of(url.toURI());
        } catch (URISyntaxException e) {
            throw new IllegalStateException(e);
        }
    }
}
