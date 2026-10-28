package io.github.kleash.activiti.scenario.jobs;

import java.util.Set;

/**
 * The process instances a scenario owns: its root instance and every child reached through
 * {@code superProcessInstanceId}, recursively. Evaluated on every call because call activities create children while
 * the scenario runs.
 */
@FunctionalInterface
public interface InstanceScope {

    Set<String> instanceIds();
}
