package io.github.kleash.activiti.harness.support;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Bean {@code transactionLog}: what the transaction-dependent listeners saw, per process instance.
 *
 * <p>A transaction-dependent listener runs around the end of a transaction (before commit, after commit, after rollback), in a
 * transaction of its own; writing process variables from it would fight with the transaction that is ending. So it records
 * here, and a later service task copies the entries into a process variable:
 * {@code activiti:expression="${transactionLog.entries(execution.processInstanceId)}"}.
 */
public class TransactionListenerLog {

    private final Map<String, List<String>> entriesByInstance = new ConcurrentHashMap<>();

    /** Appends an entry for the process instance. */
    public void record(String processInstanceId, String entry) {
        entriesByInstance.computeIfAbsent(processInstanceId, id -> Collections.synchronizedList(new ArrayList<>())).add(entry);
    }

    /** The entries recorded so far, in order, as a serializable list (empty when there are none). */
    public ArrayList<String> entries(String processInstanceId) {
        List<String> entries = entriesByInstance.get(processInstanceId);
        if (entries == null) {
            return new ArrayList<>();
        }
        synchronized (entries) {
            return new ArrayList<>(entries);
        }
    }
}
