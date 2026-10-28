package io.github.kleash.activiti.scenario;

/**
 * Constants of the scenario file layout (see docs/adr/0005-scenario-format.md).
 */
public final class ScenarioFormat {

    /** Directory, next to a model, that holds its scenario files. */
    public static final String DIRECTORY = "scenarios";

    /** File name suffix of a scenario file. */
    public static final String FILE_SUFFIX = ".scenario.json";

    private ScenarioFormat() {
    }
}
