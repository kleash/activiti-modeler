package io.github.kleash.activiti.harness.context;

/** How a project's resources reach the engine. The harness verifies both. */
public enum DeployMode {

    /**
     * Spring auto-deployment: {@code spring.activiti.process-definition-location-prefix} points at the project's
     * {@code processes/} folder (a {@code file:} URL); Spring stores <em>absolute paths</em> as resource names.
     */
    AUTO_DEPLOY("auto-deploy"),

    /** A {@code DeploymentBuilder} in a context that does not auto-deploy; resource names are the relative file names. */
    PROGRAMMATIC("programmatic");

    private final String label;

    DeployMode(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
