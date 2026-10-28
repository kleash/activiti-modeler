package io.github.kleash.activiti.modeler.launch;

import java.util.ArrayList;
import java.util.List;

/**
 * The command line of {@code java -jar activiti-modeler-server.jar}: a few short options are translated to the Spring properties
 * behind them, everything else ({@code --server.port=9000}, {@code --modeler.server.allow-shell-tasks=true}, ...) is passed on unchanged.
 *
 * <ul>
 *   <li>{@code --workspace=<folder>} or {@code --workspace <folder>}: {@code modeler.workspace.dir}</li>
 *   <li>{@code --port=<n>} or {@code --port <n>}: {@code server.port}</li>
 *   <li>{@code --open}: {@code modeler.server.open-browser=true}</li>
 *   <li>{@code --no-open}: {@code modeler.server.open-browser=false}</li>
 *   <li>{@code --no-window}: {@code modeler.server.status-window=false}</li>
 *   <li>{@code --help}, {@code -h}: print the usage</li>
 * </ul>
 */
public final class LaunchArguments {

    /** The usage text. */
    public static final String USAGE = """
            Activiti modeler server

            Usage: java -jar activiti-modeler-server.jar [options] [--spring.property=value ...]

            Without options the server starts ready to use: projects in ~/ActivitiModeler/workspace, port 8080 (a free port
            when 8080 is taken), logs in ~/ActivitiModeler/logs, the browser opens, and with a display a small window shows
            the address and has a Quit button.

              --workspace=<folder>   project folder the modeler opens and saves (modeler.workspace.dir)
              --port=<n>             HTTP port (server.port), default 8080 or a free port
              --open                 open the modeler in the browser (the default when a display exists)
              --no-open              do not open the browser
              --no-window            do not show the status window
              --help                 this text

            The server listens on 127.0.0.1 only (server.address). Demo user: modeler / modeler.
            ~/ActivitiModeler can be moved with -Dmodeler.home=<folder> or the variable MODELER_HOME.
            Any Spring Boot property can be given as --name=value, for example --modeler.server.allow-shell-tasks=true.""";

    private final List<String> springArguments;
    private final boolean help;

    private LaunchArguments(List<String> springArguments, boolean help) {
        this.springArguments = springArguments;
        this.help = help;
    }

    /** Translates the command line. */
    public static LaunchArguments translate(String[] args) {
        List<String> out = new ArrayList<>();
        boolean help = false;
        for (int i = 0; i < args.length; i++) {
            String arg = args[i];
            if (arg.equals("--help") || arg.equals("-h")) {
                help = true;
            } else if (arg.equals("--open")) {
                out.add("--modeler.server.open-browser=true");
            } else if (arg.equals("--no-open")) {
                out.add("--modeler.server.open-browser=false");
            } else if (arg.equals("--no-window")) {
                out.add("--modeler.server.status-window=false");
            } else if (arg.startsWith("--workspace=")) {
                out.add("--modeler.workspace.dir=" + arg.substring("--workspace=".length()));
            } else if (arg.equals("--workspace") && i + 1 < args.length) {
                out.add("--modeler.workspace.dir=" + args[++i]);
            } else if (arg.startsWith("--port=")) {
                out.add("--server.port=" + arg.substring("--port=".length()));
            } else if (arg.equals("--port") && i + 1 < args.length) {
                out.add("--server.port=" + args[++i]);
            } else {
                out.add(arg);
            }
        }
        return new LaunchArguments(List.copyOf(out), help);
    }

    /** @return the arguments to hand to Spring */
    public String[] springArguments() {
        return springArguments.toArray(String[]::new);
    }

    /** @return whether the usage was asked for */
    public boolean helpRequested() {
        return help;
    }
}
