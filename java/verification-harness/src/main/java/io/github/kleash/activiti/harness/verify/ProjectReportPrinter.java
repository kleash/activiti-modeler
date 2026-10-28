package io.github.kleash.activiti.harness.verify;

import java.io.PrintStream;

/** Plain text rendering of check results for the CLI. */
final class ProjectReportPrinter {

    private ProjectReportPrinter() {
    }

    static void print(PrintStream out, String check, CheckResult result) {
        out.println((result.passed() ? "  [ok]   " : "  [FAIL] ") + check);
        if (!result.passed() && result.message() != null) {
            result.message().lines().forEach(line -> out.println("           " + line));
        }
        result.notes().forEach(note -> out.println("         note: " + note));
    }
}
