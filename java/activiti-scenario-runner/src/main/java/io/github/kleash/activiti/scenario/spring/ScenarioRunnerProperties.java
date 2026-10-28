package io.github.kleash.activiti.scenario.spring;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** {@code activiti.scenario.*} settings of the scenario runner auto-configuration. */
@ConfigurationProperties(prefix = "activiti.scenario")
public class ScenarioRunnerProperties {

    /** Which job driver to use. {@code AUTO} follows {@code spring.activiti.async-executor-activate}. */
    public enum JobDriverMode { AUTO, MANUAL, EXECUTOR }

    /** Switches the whole auto-configuration (recorders, runner) off. */
    private boolean enabled = true;

    /** MANUAL when the async executor is off, EXECUTOR when it is on (AUTO), or forced. */
    private JobDriverMode jobDriver = JobDriverMode.AUTO;

    /** EXECUTOR mode: how long to wait for the async executor before a step fails. */
    private Duration executorTimeout = Duration.ofSeconds(10);

    /** Provide an ExtendedInMemoryUserDetailsManager when the application defines no UserDetailsService. */
    private boolean defaultUserDetailsService = true;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public JobDriverMode getJobDriver() {
        return jobDriver;
    }

    public void setJobDriver(JobDriverMode jobDriver) {
        this.jobDriver = jobDriver;
    }

    public Duration getExecutorTimeout() {
        return executorTimeout;
    }

    public void setExecutorTimeout(Duration executorTimeout) {
        this.executorTimeout = executorTimeout;
    }

    public boolean isDefaultUserDetailsService() {
        return defaultUserDetailsService;
    }

    public void setDefaultUserDetailsService(boolean defaultUserDetailsService) {
        this.defaultUserDetailsService = defaultUserDetailsService;
    }
}
