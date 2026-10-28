package io.github.kleash.activiti.harness.verify;

import java.io.PrintStream;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.project.Project;

/** Runs all checks of one project in one deploy mode and prints a report; used by the CLI. */
public final class ProjectRun {

    /**
     * @param checks number of checks run
     * @param failed number of checks that failed
     */
    public record Summary(int checks, int failed) {
        public Summary plus(Summary other) {
            return new Summary(checks + other.checks, failed + other.failed);
        }
    }

    private ProjectRun() {
    }

    public static Summary run(Project project, DeployMode mode, PrintStream out) {
        out.println();
        out.println("Project " + project.id() + " (" + project.origin().name().toLowerCase() + ", " + mode.label() + ")");
        int checks = 0;
        int failed = 0;
        try (ProjectVerifier verifier = new ProjectVerifier(project, mode)) {
            for (Check check : verifier.checks()) {
                CheckResult result = check.run();
                checks++;
                if (!result.passed()) {
                    failed++;
                }
                ProjectReportPrinter.print(out, check.name(), result);
            }
        }
        return new Summary(checks, failed);
    }
}
