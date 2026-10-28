package io.github.kleash.activiti.scenario.recording;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.activiti.api.process.model.IntegrationContext;
import org.activiti.api.process.runtime.connector.Connector;
import org.junit.jupiter.api.Test;

class RecordingConnectorTest {

    private final ConnectorCallRecorder recorder = new ConnectorCallRecorder();

    private static IntegrationContext context(String instanceId, String activityId, Map<String, Object> inbound) {
        IntegrationContext context = mock(IntegrationContext.class);
        when(context.getProcessInstanceId()).thenReturn(instanceId);
        when(context.getClientId()).thenReturn(activityId);
        when(context.getClientName()).thenReturn("Task " + activityId);
        when(context.getConnectorType()).thenReturn("crm.LOOKUP");
        when(context.getInBoundVariables()).thenReturn(inbound);
        return context;
    }

    @Test
    void recordsAnIndependentCopyOfTheInboundVariablesBeforeTheCall() {
        Map<String, Object> inbound = new LinkedHashMap<>();
        inbound.put("customerId", "C-7");
        inbound.put("list", new java.util.ArrayList<>(List.of(1, 2)));
        IntegrationContext context = context("pi-1", "lookup", inbound);
        Connector mutating = ctx -> {
            ctx.getInBoundVariables().put("added", true);
            ((List<Object>) ctx.getInBoundVariables().get("list")).add(3);
            when(ctx.getOutBoundVariables()).thenReturn(Map.of("name", "Ann"));
            return ctx;
        };

        IntegrationContext result = new RecordingConnector("crm.LOOKUP", mutating, recorder).apply(context);

        assertThat(result).isSameAs(context);
        ConnectorCall call = recorder.callsOf(Set.of("pi-1")).get(0);
        assertThat(call.inbound()).containsOnlyKeys("customerId", "list").containsEntry("customerId", "C-7");
        assertThat(call.inbound().get("list")).isEqualTo(List.of(1, 2));
        assertThat(call.outbound()).containsEntry("name", "Ann");
        assertThat(call.activityId()).isEqualTo("lookup");
        assertThat(call.activityName()).isEqualTo("Task lookup");
        assertThat(call.connector()).isEqualTo("crm.LOOKUP");
        assertThat(call.error()).isNull();
    }

    @Test
    void aFailingConnectorIsRecordedAndTheExceptionPropagates() {
        IntegrationContext context = context("pi-1", "lookup", Map.of("a", 1));
        Connector failing = ctx -> {
            throw new IllegalStateException("down");
        };
        assertThatThrownBy(() -> new RecordingConnector("crm.LOOKUP", failing, recorder).apply(context))
                .isInstanceOf(IllegalStateException.class).hasMessage("down");
        ConnectorCall call = recorder.callsOf(Set.of("pi-1")).get(0);
        assertThat(call.error()).isEqualTo("java.lang.IllegalStateException: down");
        assertThat(call.outbound()).isEmpty();
    }

    @Test
    void callsAreScopedToInstancesKeptInOrderAndClearable() {
        Connector noop = ctx -> ctx;
        RecordingConnector connector = new RecordingConnector("crm.LOOKUP", noop, recorder);
        connector.apply(context("pi-1", "a", Map.of()));
        connector.apply(context("pi-2", "b", Map.of()));
        connector.apply(context("pi-1", "c", Map.of()));

        assertThat(recorder.callsOf(Set.of("pi-1"))).extracting(ConnectorCall::activityId).containsExactly("a", "c");
        assertThat(recorder.callsOf(Set.of("pi-1", "pi-2"))).extracting(ConnectorCall::activityId).containsExactly("a", "b", "c");
        assertThat(recorder.callsOf(Set.of("other"))).isEmpty();
        assertThat(recorder.callsOf(Set.of("pi-1", "pi-2")).get(0).sequence()).isLessThan(recorder.callsOf(Set.of("pi-1", "pi-2")).get(2).sequence());

        recorder.clear(Set.of("pi-1"));
        assertThat(recorder.callsOf(Set.of("pi-1", "pi-2"))).extracting(ConnectorCall::activityId).containsExactly("b");
    }

    @Test
    void theConnectorTypeFallsBackToTheBeanName() {
        IntegrationContext context = context("pi-1", "x", Map.of());
        when(context.getConnectorType()).thenReturn(null);
        new RecordingConnector("fallback.BEAN", ctx -> ctx, recorder).apply(context);
        assertThat(recorder.callsOf(Set.of("pi-1")).get(0).connector()).isEqualTo("fallback.BEAN");
    }

    @Test
    void thePostProcessorWrapsConnectorsOnceAndLeavesOtherBeansAlone() {
        RecordingConnectorPostProcessor processor = new RecordingConnectorPostProcessor(recorder);
        Connector connector = ctx -> ctx;
        Object wrapped = processor.postProcessAfterInitialization(connector, "crm.LOOKUP");
        assertThat(wrapped).isInstanceOf(RecordingConnector.class);
        assertThat(((RecordingConnector) wrapped).delegate()).isSameAs(connector);
        assertThat(processor.postProcessAfterInitialization(wrapped, "crm.LOOKUP")).isSameAs(wrapped);
        Object other = new Object();
        assertThat(processor.postProcessAfterInitialization(other, "other")).isSameAs(other);
    }
}
