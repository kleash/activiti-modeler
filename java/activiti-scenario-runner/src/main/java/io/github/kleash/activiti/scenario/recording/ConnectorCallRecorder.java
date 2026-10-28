package io.github.kleash.activiti.scenario.recording;

import java.util.Collection;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicLong;

/** Thread-safe, bounded store of the {@link ConnectorCall}s captured by {@link RecordingConnector}. */
public final class ConnectorCallRecorder {

    private static final int CAPACITY = 50_000;

    private final ConcurrentLinkedQueue<ConnectorCall> calls = new ConcurrentLinkedQueue<>();
    private final AtomicLong sequence = new AtomicLong();

    long nextSequence() {
        return sequence.incrementAndGet();
    }

    void record(ConnectorCall call) {
        calls.add(call);
        while (calls.size() > CAPACITY) {
            calls.poll();
        }
    }

    /** Calls made for process instances in {@code instanceIds}, in call order. */
    public List<ConnectorCall> callsOf(Collection<String> instanceIds) {
        return calls.stream().filter(c -> instanceIds.contains(c.processInstanceId())).toList();
    }

    /** Forgets the calls of the given instances (a scenario run is over). */
    public void clear(Collection<String> instanceIds) {
        calls.removeIf(c -> instanceIds.contains(c.processInstanceId()));
    }
}
