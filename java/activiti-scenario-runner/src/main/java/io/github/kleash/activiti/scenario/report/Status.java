package io.github.kleash.activiti.scenario.report;

/** Outcome of a step, scenario, decision case or file. */
public enum Status {
    PASSED,
    FAILED,
    /** A step that was not run because an earlier step of its scenario failed. */
    SKIPPED
}
