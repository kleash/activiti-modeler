package io.github.kleash.activiti.harness;

import java.io.PrintStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;
import io.github.kleash.activiti.harness.verify.ProjectRun;

/**
 * {@code verify <dir>}: deploys and runs the models in a folder - a project with {@code processes/} and
 * {@code scenarios/}, or a folder of such projects - on embedded Activiti 9.0.0, one Spring context and H2 database
 * per project and deploy mode, and prints one line per check. Exit status 0 when everything passed, 1 when a check
 * failed, 2 on a usage error.
 *
 * <pre>
 *   scripts/verify-models.sh my-models
 *   mvn -f java/pom.xml -pl verification-harness exec:java -Dexec.args="my-models --mode auto"
 * </pre>
 *
 * Options: {@code --mode auto|programmatic|both} (default both), {@code --project <id-prefix>[,...]} to select
 * projects of a folder of projects. The word {@code verify} before the folder is accepted and ignored.
 */
public final class VerifyCli {

    private VerifyCli() {
    }

    public static void main(String[] args) {
        // the check lines are the output; Spring and Activiti startup logging is noise (override with -Dlogging.level.root=INFO)
        System.setProperty("logging.level.root", System.getProperty("logging.level.root", "WARN"));
        System.exit(run(args, System.out, System.err));
    }

    /** Testable entry point; returns the exit status. */
    public static int run(String[] args, PrintStream out, PrintStream err) {
        String directory = null;
        String mode = "both";
        String projects = null;
        for (int i = 0; i < args.length; i++) {
            String arg = args[i];
            switch (arg) {
                case "verify" -> { /* optional verb */ }
                case "--mode" -> mode = i + 1 < args.length ? args[++i] : null;
                case "--project" -> projects = i + 1 < args.length ? args[++i] : null;
                case "-h", "--help" -> {
                    usage(out);
                    return 0;
                }
                default -> {
                    if (arg.startsWith("--") || directory != null) {
                        err.println("Unexpected argument: " + arg);
                        usage(err);
                        return 2;
                    }
                    directory = arg;
                }
            }
        }
        if (directory == null || mode == null) {
            usage(err);
            return 2;
        }
        List<DeployMode> modes = new ArrayList<>();
        switch (mode) {
            case "auto" -> modes.add(DeployMode.AUTO_DEPLOY);
            case "programmatic" -> modes.add(DeployMode.PROGRAMMATIC);
            case "both" -> modes.addAll(List.of(DeployMode.AUTO_DEPLOY, DeployMode.PROGRAMMATIC));
            default -> {
                err.println("Unknown --mode " + mode + " (auto, programmatic or both)");
                return 2;
            }
        }
        List<Project> found;
        try {
            found = ProjectDiscovery.filter(ProjectDiscovery.directory(Path.of(directory)), projects);
        } catch (IllegalArgumentException e) {
            err.println(e.getMessage());
            return 2;
        }
        if (found.isEmpty()) {
            err.println("No project matches --project " + projects);
            return 2;
        }

        ProjectRun.Summary total = new ProjectRun.Summary(0, 0);
        for (Project project : found) {
            for (DeployMode deployMode : modes) {
                total = total.plus(ProjectRun.run(project, deployMode, out));
            }
        }
        out.println();
        out.println((total.failed() == 0 ? "PASSED" : "FAILED") + ": " + found.size() + " project(s), " + modes.size() + " deploy mode(s), "
                + total.checks() + " checks, " + total.failed() + " failed");
        return total.failed() == 0 ? 0 : 1;
    }

    private static void usage(PrintStream out) {
        out.println("usage: verify <dir> [--mode auto|programmatic|both] [--project <id-prefix>[,...]]");
        out.println("  <dir> holds processes/ and scenarios/ (a project) or sub folders that do.");
    }
}
