package io.github.kleash.activiti.harness.verify;

import java.util.List;

/**
 * Outcome of one {@link Check}.
 *
 * @param passed  whether the check passed
 * @param message precise failure message (multi-line allowed), or {@code null} when passed
 * @param notes   information worth logging even when passed, e.g. expected validator warnings
 * @param cause   the exception behind a failure, or {@code null}
 */
public record CheckResult(boolean passed, String message, List<String> notes, Throwable cause) {

    public CheckResult {
        notes = notes == null ? List.of() : List.copyOf(notes);
    }

    public static CheckResult pass() {
        return new CheckResult(true, null, List.of(), null);
    }

    public static CheckResult pass(List<String> notes) {
        return new CheckResult(true, null, notes, null);
    }

    public static CheckResult fail(String message) {
        return new CheckResult(false, message, List.of(), null);
    }

    public static CheckResult fail(String message, Throwable cause) {
        return new CheckResult(false, message, List.of(), cause);
    }
}
