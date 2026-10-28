package io.github.kleash.activiti.scenario.recording;

import java.util.Map;

/**
 * One call of a {@code Connector} bean made by a service task, as captured by {@link RecordingConnector}.
 * The inbound variables are a deep copy taken before the call.
 */
public final class ConnectorCall {

    private final long sequence;
    private final String processInstanceId;
    private final String activityId;
    private final String activityName;
    private final String connector;
    private final Map<String, Object> inbound;
    private volatile Map<String, Object> outbound = Map.of();
    private volatile String error;

    public ConnectorCall(long sequence, String processInstanceId, String activityId, String activityName, String connector,
                         Map<String, Object> inbound) {
        this.sequence = sequence;
        this.processInstanceId = processInstanceId;
        this.activityId = activityId;
        this.activityName = activityName;
        this.connector = connector;
        this.inbound = inbound;
    }

    /** Position of the call in the global call order. */
    public long sequence() { return sequence; }

    public String processInstanceId() { return processInstanceId; }

    /** The id of the service task element (the integration context's client id). */
    public String activityId() { return activityId; }

    public String activityName() { return activityName; }

    /** The service task's {@code implementation} (the connector bean name, e.g. {@code crm.LOOKUP}). */
    public String connector() { return connector; }

    /** Inbound variables: the mapped inputs plus constants. */
    public Map<String, Object> inbound() { return inbound; }

    /** Outbound variables the connector returned (empty if it threw). */
    public Map<String, Object> outbound() { return outbound; }

    /** {@code null} when the call returned normally, otherwise the exception's description. */
    public String error() { return error; }

    void completed(Map<String, Object> outbound) { this.outbound = outbound; }

    void failed(Throwable t) { this.error = t.getClass().getName() + ": " + t.getMessage(); }

    @Override
    public String toString() {
        return "call #" + sequence + " of " + connector + " at " + activityId + " in " + processInstanceId + " inbound=" + inbound;
    }
}
