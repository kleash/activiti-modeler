package io.github.kleash.activiti.harness.support;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

import org.activiti.engine.delegate.VariableScope;

/**
 * Support beans record what they saw into process variables that hold a list of strings, so that scenarios can assert
 * on them with {@code expect.variables}.
 */
final class CallLog {

    private CallLog() {
    }

    /**
     * Appends {@code entry} to the list variable {@code variable} of the process instance that owns {@code scope}
     * (creating it when missing).
     */
    @SuppressWarnings("unchecked")
    static void append(VariableScope scope, String variable, String entry) {
        Object current = scope.getVariable(variable);
        ArrayList<String> list = current instanceof List<?> existing ? new ArrayList<>((List<String>) existing) : new ArrayList<>();
        list.add(entry);
        scope.setVariable(variable, (Serializable) list);
    }
}
