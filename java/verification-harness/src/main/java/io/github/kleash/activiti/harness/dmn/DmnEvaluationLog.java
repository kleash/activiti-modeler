package io.github.kleash.activiti.harness.dmn;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import io.github.kleash.activiti.dmn.DmnResource;

/**
 * Every decision evaluation of one project context, as the DMN engine of the project saw it: the decisions that
 * decision tasks run inside process instances and the direct evaluations of the scenario files' {@code decisions[]}
 * all go through the {@code DmnEvaluator} bean, which {@link RecordingDmnEvaluator} wraps. The log is what the DMN
 * cross-check replays on the other engine.
 */
public final class DmnEvaluationLog {

    /**
     * One call of {@code DmnEvaluator.evaluate}.
     *
     * @param resource    the DMN document
     * @param decisionRef the decision id the engine was asked for ({@code null}: the sink decision)
     * @param inputs      a deep copy of the input variables
     * @param failure     {@code null} when the engine returned a result, else the exception it threw
     */
    public record Call(DmnResource resource, String decisionRef, Map<String, Object> inputs, RuntimeException failure) {

        /** Same document, decision and inputs: the cross-check replays each of those once. */
        public String key() {
            return resource.name() + '\n' + resource.contentHash() + '\n' + decisionRef + '\n' + inputs;
        }

        @Override
        public String toString() {
            return "decision " + (decisionRef != null ? decisionRef : "<sink>") + " of " + resource.name() + " with inputs " + inputs;
        }
    }

    private final List<Call> calls = new CopyOnWriteArrayList<>();

    void record(DmnResource resource, String decisionRef, Map<String, Object> inputs, RuntimeException failure) {
        calls.add(new Call(resource, decisionRef, deepCopy(inputs), failure));
    }

    /** All calls so far, in order. */
    public List<Call> calls() {
        return List.copyOf(calls);
    }

    /** The calls without repetitions (same document, decision and inputs), in order of first occurrence. */
    public List<Call> distinctCalls() {
        Map<String, Call> byKey = new LinkedHashMap<>();
        calls.forEach(c -> byKey.putIfAbsent(c.key(), c));
        return new ArrayList<>(byKey.values());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> deepCopy(Map<String, Object> map) {
        Map<String, Object> copy = new LinkedHashMap<>();
        map.forEach((k, v) -> copy.put(k, (Object) copyValue(v)));
        return copy;
    }

    @SuppressWarnings("unchecked")
    private static Object copyValue(Object value) {
        if (value instanceof Map<?, ?> m) {
            return deepCopy((Map<String, Object>) m);
        }
        if (value instanceof List<?> l) {
            return l.stream().map(DmnEvaluationLog::copyValue).toList();
        }
        return value;
    }
}
