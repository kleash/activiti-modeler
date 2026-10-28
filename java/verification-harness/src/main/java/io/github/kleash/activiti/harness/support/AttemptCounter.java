package io.github.kleash.activiti.harness.support;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Bean {@code attemptCounter}: counts how often something ran, across transactions that roll back.
 *
 * <p>A failed job is retried, but the transaction of each attempt is rolled back, so a process variable cannot count the
 * attempts. The counting failure delegate and listener keep the number here (key: process instance id and activity id) and
 * put it into the exception message ({@code "... (attempt 3)"}), which the engine copies to the failed job and finally to
 * the dead-letter job: a scenario can then assert, with {@code deadLetterJobs.exceptionMessageContains}, after how many
 * attempts the job gave up.
 */
public class AttemptCounter {

    private final Map<String, AtomicInteger> attempts = new ConcurrentHashMap<>();

    /** Counts one more attempt for the key and returns the new count (1 for the first). */
    public int next(String key) {
        return attempts.computeIfAbsent(key, k -> new AtomicInteger()).incrementAndGet();
    }
}
