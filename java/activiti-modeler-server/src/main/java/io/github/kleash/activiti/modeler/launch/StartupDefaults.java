package io.github.kleash.activiti.modeler.launch;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.IntUnaryOperator;

/**
 * The defaults of a start without arguments (ADR 0008), computed by {@code main} before Spring starts and handed to Spring as
 * <em>default properties</em>, the lowest precedence: an argument, a system property, an environment variable, a profile file or
 * {@code application.properties} always wins. Tests never run {@code main}, so none of this applies to them.
 *
 * <ul>
 *   <li>the workspace: {@code ~/ActivitiModeler/workspace}, created on first start;</li>
 *   <li>the port: 8080, or a free one when 8080 is taken;</li>
 *   <li>the browser opens, and a status window appears, when a display exists;</li>
 *   <li>logs also go to {@code ~/ActivitiModeler/logs/}.</li>
 * </ul>
 *
 * The home folder is {@code ~/ActivitiModeler}, or the system property {@code modeler.home} / the variable {@code MODELER_HOME}.
 * The {@code container} profile (the Docker image) gets none of the interactive defaults: it names its own workspace and port.
 */
public final class StartupDefaults {

    /** System property that moves {@code ~/ActivitiModeler}. */
    public static final String HOME_PROPERTY = "modeler.home";
    /** Environment variable that moves {@code ~/ActivitiModeler}. */
    public static final String HOME_VARIABLE = "MODELER_HOME";
    /** The port tried first. */
    public static final int PREFERRED_PORT = 8080;

    static final String WORKSPACE = "modeler.workspace.dir";
    static final String PORT = "server.port";
    static final String OPEN_BROWSER = "modeler.server.open-browser";
    static final String STATUS_WINDOW = "modeler.server.status-window";
    static final String LOG_FILE = "logging.file.name";
    static final String LOG_PATH = "logging.file.path";

    private final Map<String, Object> properties;
    private final List<String> notes;
    private final boolean statusWindow;
    private final Path home;

    private StartupDefaults(Map<String, Object> properties, List<String> notes, boolean statusWindow, Path home) {
        this.properties = properties;
        this.notes = notes;
        this.statusWindow = statusWindow;
        this.home = home;
    }

    /**
     * @param springArguments the arguments for Spring, already translated by {@link LaunchArguments}
     * @param environment     system properties, variables and the home folder
     * @param headless        whether no display is available
     */
    public static StartupDefaults resolve(String[] springArguments, LaunchEnvironment environment, boolean headless) {
        return resolve(springArguments, environment, headless, PortSelection::choose);
    }

    /** As above with the port chooser given (a test replaces the real socket probe). */
    public static StartupDefaults resolve(String[] springArguments, LaunchEnvironment environment, boolean headless, IntUnaryOperator portChooser) {
        Path home = home(environment);
        boolean container = containerProfile(springArguments, environment);
        Map<String, Object> properties = new LinkedHashMap<>();
        List<String> notes = new ArrayList<>();

        if (!container && !given(WORKSPACE, springArguments, environment)) {
            Path workspace = home.resolve("workspace");
            createDirectories(workspace);
            properties.put(WORKSPACE, workspace.toString());
        }
        if (!given(PORT, springArguments, environment)) {
            int port = portChooser.applyAsInt(PREFERRED_PORT);
            if (port != PREFERRED_PORT) {
                notes.add("Port " + PREFERRED_PORT + " is in use; using port " + port + " instead.");
            }
            properties.put(PORT, port);
        }
        boolean interactive = !headless && !container;
        if (!given(OPEN_BROWSER, springArguments, environment)) {
            properties.put(OPEN_BROWSER, interactive);
        }
        boolean window = interactive;
        String windowSetting = value(STATUS_WINDOW, springArguments, environment);
        if (windowSetting != null) {
            window = Boolean.parseBoolean(windowSetting.trim()) && !headless;
        }
        properties.put(STATUS_WINDOW, window);
        if (!container && !given(LOG_FILE, springArguments, environment) && !given(LOG_PATH, springArguments, environment)) {
            Path logs = home.resolve("logs");
            createDirectories(logs);
            properties.put(LOG_FILE, logs.resolve("activiti-modeler.log").toString());
            properties.put("logging.logback.rollingpolicy.max-file-size", "10MB");
            properties.put("logging.logback.rollingpolicy.max-history", "7");
            properties.put("logging.logback.rollingpolicy.total-size-cap", "100MB");
        }
        return new StartupDefaults(properties, List.copyOf(notes), window, home);
    }

    /** @return {@code ~/ActivitiModeler}, or the folder named by {@code -Dmodeler.home} or {@code MODELER_HOME} */
    public static Path home(LaunchEnvironment environment) {
        String configured = environment.systemProperty(HOME_PROPERTY);
        if (configured == null || configured.isBlank()) {
            configured = environment.environmentVariable(HOME_VARIABLE);
        }
        if (configured != null && !configured.isBlank()) {
            return Path.of(configured.trim()).toAbsolutePath().normalize();
        }
        return environment.userHome().resolve("ActivitiModeler");
    }

    /** @return the lowest-precedence properties to hand to Spring */
    public Map<String, Object> properties() {
        return properties;
    }

    /** @return lines to print before start (for example the port fallback) */
    public List<String> notes() {
        return notes;
    }

    /** @return whether the status window should be shown */
    public boolean statusWindow() {
        return statusWindow;
    }

    /** @return the {@code ~/ActivitiModeler} folder in use */
    public Path home() {
        return home;
    }

    // ---- is a property given by the person? -------------------------------------------------------------------------------------

    private static boolean given(String property, String[] arguments, LaunchEnvironment environment) {
        return value(property, arguments, environment) != null;
    }

    /** The value from an argument ({@code --name=value}), a system property or an environment variable (Spring's relaxed names), or {@code null}. */
    private static String value(String property, String[] arguments, LaunchEnvironment environment) {
        String prefix = "--" + property + "=";
        for (String argument : arguments) {
            if (argument.startsWith(prefix)) {
                return argument.substring(prefix.length());
            }
        }
        String system = environment.systemProperty(property);
        if (system != null) {
            return system;
        }
        String upper = property.toUpperCase(Locale.ROOT);
        for (String name : new String[] {upper.replace('.', '_').replace('-', '_'), upper.replace('.', '_').replace("-", "")}) {
            String variable = environment.environmentVariable(name);
            if (variable != null) {
                return variable;
            }
        }
        return null;
    }

    private static boolean containerProfile(String[] arguments, LaunchEnvironment environment) {
        String profiles = value("spring.profiles.active", arguments, environment);
        if (profiles == null) {
            profiles = environment.environmentVariable("SPRING_PROFILES_ACTIVE");
        }
        if (profiles == null) {
            return false;
        }
        for (String profile : profiles.split(",")) {
            if (profile.trim().equals("container")) {
                return true;
            }
        }
        return false;
    }

    private static void createDirectories(Path directory) {
        try {
            Files.createDirectories(directory);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot create " + directory + " (move it with --workspace=<folder> or -Dmodeler.home=<folder>): " + e.getMessage(), e);
        }
    }
}
