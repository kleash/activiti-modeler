package io.github.kleash.activiti.modeler;

import java.awt.GraphicsEnvironment;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

import io.github.kleash.activiti.modeler.launch.LaunchArguments;
import io.github.kleash.activiti.modeler.launch.LaunchEnvironment;
import io.github.kleash.activiti.modeler.launch.StartupDefaults;
import io.github.kleash.activiti.modeler.launch.StatusWindow;
import io.github.kleash.activiti.modeler.launch.StatusWindowListener;

/**
 * Entry point of the modeler server: the modeler app, the runtime REST API (core and dev) and embedded Activiti.
 * <pre>java -jar activiti-modeler-server.jar [--workspace=&lt;folder&gt;] [--port=8080] [--no-open] [--no-window]</pre>
 * Without arguments it is ready to use: see {@link StartupDefaults} (ADR 0008). Tests start the application through
 * {@code @SpringBootTest}, which never runs {@code main}, so they get none of the interactive defaults.
 */
@SpringBootApplication
@EnableConfigurationProperties(ModelerServerProperties.class)
public class ModelerServerApplication {

    public static void main(String[] args) {
        LaunchArguments launch = LaunchArguments.translate(args);
        if (launch.helpRequested()) {
            System.out.println(LaunchArguments.USAGE);
            return;
        }
        // Asked before Spring starts: SpringApplication sets java.awt.headless=true unless told otherwise, which would forbid the window.
        boolean headless = GraphicsEnvironment.isHeadless();
        StartupDefaults defaults = StartupDefaults.resolve(launch.springArguments(), LaunchEnvironment.system(), headless);
        defaults.notes().forEach(System.out::println);

        SpringApplication application = new SpringApplication(ModelerServerApplication.class);
        application.setDefaultProperties(defaults.properties());
        StatusWindow window = null;
        if (defaults.statusWindow()) {
            try {
                window = StatusWindow.show(() -> System.exit(0));
                application.setHeadless(false);
                application.addListeners(new StatusWindowListener(window));
            } catch (Throwable problem) {
                // a display that is announced but cannot be reached must not keep the server from starting
                System.err.println("Cannot show the status window (" + problem.getMessage() + "); continuing without it. --no-window silences this.");
                window = null;
            }
        }
        try {
            application.run(launch.springArguments());
        } catch (RuntimeException | Error failure) {
            if (window == null) {
                throw failure;
            }
            // A double-clicked app has no console: say it in the window, which stays until Quit.
            window.failed(String.valueOf(rootCause(failure).getMessage()), defaults.home().resolve("logs").toString());
        }
    }

    private static Throwable rootCause(Throwable failure) {
        Throwable cause = failure;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        return cause;
    }
}
