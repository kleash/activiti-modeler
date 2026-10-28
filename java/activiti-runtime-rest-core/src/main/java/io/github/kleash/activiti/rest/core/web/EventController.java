package io.github.kleash.activiti.rest.core.web;

import org.activiti.api.process.model.builders.MessagePayloadBuilder;
import org.activiti.api.process.model.builders.ProcessPayloadBuilder;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;

import io.github.kleash.activiti.rest.core.ApiPaths;
import io.github.kleash.activiti.rest.core.dto.EventDtos;
import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.core.service.InstanceService;
import io.github.kleash.activiti.rest.core.service.Values;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RuntimeRestController
@RequestMapping(ApiPaths.BASE)
@Tag(name = "Events", description = "Messages, signals and triggers")
public class EventController {

    private final ProcessRuntime processRuntime;
    private final InstanceService instances;

    public EventController(ProcessRuntime processRuntime, InstanceService instances) {
        this.processRuntime = processRuntime;
        this.instances = instances;
    }

    @PostMapping("/messages")
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "sendMessage",
            summary = "Send a message to the one waiting subscription of that name and correlation key (ProcessRuntime.receive); to start an instance by message use POST /process-instances")
    public EventDtos.Delivered message(@RequestBody EventDtos.MessageRequest request) {
        require(request.name(), "name");
        processRuntime.receive(MessagePayloadBuilder.receive(request.name()).withCorrelationKey(request.correlationKey())
                .withVariables(Values.nonNull(request.variables())).build());
        return new EventDtos.Delivered("message", request.name());
    }

    @PostMapping("/signals")
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "sendSignal", summary = "Broadcast a signal to every waiting instance (ProcessRuntime.signal)")
    public EventDtos.Delivered signal(@RequestBody EventDtos.SignalRequest request) {
        require(request.name(), "name");
        processRuntime.signal(ProcessPayloadBuilder.signal().withName(request.name()).withVariables(Values.nonNull(request.variables())).build());
        return new EventDtos.Delivered("signal", request.name());
    }

    @PostMapping("/executions/{id}/trigger")
    @RequiresAccess(Access.OPERATE)
    @Operation(operationId = "triggerExecution", summary = "Trigger an execution that waits at a receive task (RuntimeService.trigger)")
    public EventDtos.Delivered trigger(@PathVariable String id, @RequestBody(required = false) EventDtos.TriggerRequest request) {
        instances.trigger(id, request == null ? null : request.variables());
        return new EventDtos.Delivered("trigger", id);
    }

    private static void require(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
    }
}
