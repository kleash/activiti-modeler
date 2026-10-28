package io.github.kleash.activiti.modeler.launch;

import java.nio.file.Path;
import java.util.Map;

/**
 * What the start-up defaults ask the machine: system properties, environment variables and the user's home folder. A seam so that
 * tests decide all three and never touch the real home directory.
 */
public interface LaunchEnvironment {

    /** @return the system property, or {@code null} */
    String systemProperty(String name);

    /** @return the environment variable, or {@code null} */
    String environmentVariable(String name);

    /** @return the user's home folder */
    Path userHome();

    /** @return the real system, properties and environment of this JVM */
    static LaunchEnvironment system() {
        return new LaunchEnvironment() {
            @Override
            public String systemProperty(String name) {
                return System.getProperty(name);
            }

            @Override
            public String environmentVariable(String name) {
                return System.getenv(name);
            }

            @Override
            public Path userHome() {
                return Path.of(System.getProperty("user.home"));
            }
        };
    }

    /** @return a fixed environment, for tests */
    static LaunchEnvironment of(Map<String, String> systemProperties, Map<String, String> environmentVariables, Path userHome) {
        return new LaunchEnvironment() {
            @Override
            public String systemProperty(String name) {
                return systemProperties.get(name);
            }

            @Override
            public String environmentVariable(String name) {
                return environmentVariables.get(name);
            }

            @Override
            public Path userHome() {
                return userHome;
            }
        };
    }
}
