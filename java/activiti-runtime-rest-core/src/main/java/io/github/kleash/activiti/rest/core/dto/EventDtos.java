package io.github.kleash.activiti.rest.core.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Map;

/** Messages, signals and triggers. */
public final class EventDtos {

    private EventDtos() {
    }

    /**
     * Send a message to the one waiting subscription of that name ({@code ProcessRuntime.receive}).
     *
     * @param name           message name
     * @param correlationKey correlation key of the subscription; required when the subscription has one
     * @param variables      variables delivered with the message
     */
    @StrictBody
    @Schema(requiredProperties = {"name"})
    public record MessageRequest(String name, String correlationKey, Map<String, Object> variables) {
    }

    /**
     * Broadcast a signal to every waiting instance.
     *
     * @param name      signal name
     * @param variables variables delivered with the signal
     */
    @StrictBody
    @Schema(requiredProperties = {"name"})
    public record SignalRequest(String name, Map<String, Object> variables) {
    }

    /** Body of {@code POST /executions/{id}/trigger}. */
    @StrictBody
    public record TriggerRequest(Map<String, Object> variables) {
    }

    /**
     * @param type {@code message}, {@code signal} or {@code trigger}
     * @param name the message or signal name, or the execution id
     */
    @Schema(requiredProperties = {"type", "name"})
    public record Delivered(String type, String name) {
    }
}
