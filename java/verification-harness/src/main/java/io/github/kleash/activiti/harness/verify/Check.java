package io.github.kleash.activiti.harness.verify;

/** One verification step of a project: becomes a JUnit dynamic test or a line of the CLI report. */
public interface Check {

    /** Display name, unique within a project run. */
    String name();

    /** Runs the check. Checks of one project must run in the order {@link ProjectVerifier#checks()} returns them. */
    CheckResult run();
}
