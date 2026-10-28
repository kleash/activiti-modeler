package io.github.kleash.activiti.scenario.report;

/**
 * Result of one step. {@code message} is {@code null} for passed steps, otherwise the precise reason.
 *
 * @param index       1-based position in the scenario ({@code 0}: the start)
 * @param type        step type (JSON key) or {@code start}
 * @param description one-line description, e.g. {@code completeTask review as alice}
 * @param status      PASSED, FAILED or SKIPPED
 * @param message     failure message, or {@code null}
 * @param durationMs  wall-clock time
 */
public record StepReport(int index, String type, String description, Status status, String message, long durationMs) {
}
