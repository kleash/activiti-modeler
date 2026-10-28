package io.github.kleash.activiti.rest.dev;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** {@code activiti.rest.dev.*}: the development-only endpoints. */
@ConfigurationProperties(prefix = "activiti.rest.dev")
public class DevProperties {

    /** Registers the dev endpoints. They deploy arbitrary models (remote code execution): enable them only on a development machine. */
    private boolean enabled = false;

    /** How long a scenario run waits for another run to finish before it answers 409. */
    private Duration scenarioLockTimeout = Duration.ofSeconds(30);

    /** Largest request body of the validate, deploy, scenario and decision endpoints, in characters of all file contents together. */
    private int maxFilesCharacters = 20_000_000;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Duration getScenarioLockTimeout() {
        return scenarioLockTimeout;
    }

    public void setScenarioLockTimeout(Duration scenarioLockTimeout) {
        this.scenarioLockTimeout = scenarioLockTimeout;
    }

    public int getMaxFilesCharacters() {
        return maxFilesCharacters;
    }

    public void setMaxFilesCharacters(int maxFilesCharacters) {
        this.maxFilesCharacters = maxFilesCharacters;
    }
}
