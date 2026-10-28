package io.github.kleash.activiti.harness.support;

import java.util.Map;

import org.activiti.api.process.model.IntegrationContext;
import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.engine.delegate.BpmnError;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Connector beans for service tasks with {@code implementation="<bean name>"} (docs/corpus-support.md).
 * The bean name is {@code <connector>.<ACTION>}; the connector descriptors under {@code connectors/} have the name
 * before the dot.
 */
@Configuration(proxyBeanMethods = false)
public class CorpusConnectors {

    /**
     * {@code crm.LOOKUP}: inbound {@code customerId} (string). Outbound {@code customerName} ({@code "Customer <id>"}),
     * {@code tier} ({@code "gold"} when the id starts with {@code G-}, else {@code "standard"}) and {@code found}
     * ({@code true}). A missing {@code customerId} yields {@code found=false} and nothing else.
     */
    @Bean(name = "crm.LOOKUP")
    public Connector crmLookup() {
        return context -> {
            Object customerId = context.getInBoundVariables().get("customerId");
            if (customerId == null) {
                context.addOutBoundVariable("found", false);
                return context;
            }
            String id = String.valueOf(customerId);
            context.addOutBoundVariable("customerName", "Customer " + id);
            context.addOutBoundVariable("tier", id.startsWith("G-") ? "gold" : "standard");
            context.addOutBoundVariable("found", true);
            return context;
        };
    }

    /**
     * {@code echo.EXECUTE}: returns every inbound variable unchanged as an outbound variable of the same name and adds
     * {@code echoCount}, the number of inbound variables.
     */
    @Bean(name = "echo.EXECUTE")
    public Connector echo() {
        return context -> {
            Map<String, Object> inbound = context.getInBoundVariables();
            context.addOutBoundVariables(inbound);
            context.addOutBoundVariable("echoCount", inbound.size());
            return context;
        };
    }

    /**
     * {@code failing.EXECUTE}: always throws {@link IllegalStateException} with the message
     * {@code "failing connector: <reason>"}, where reason is the inbound variable {@code reason} (default {@code boom}).
     */
    @Bean(name = "failing.EXECUTE")
    public Connector failing() {
        return context -> {
            Object reason = context.getInBoundVariables().get("reason");
            throw new IllegalStateException("failing connector: " + (reason != null ? reason : "boom"));
        };
    }

    /**
     * {@code bpmnerror.EXECUTE}: always throws a {@link BpmnError}; the error code is the inbound variable
     * {@code errorCode} (default {@code CONNECTOR_ERROR}), the message {@code "bpmn error from connector"}.
     */
    @Bean(name = "bpmnerror.EXECUTE")
    public Connector bpmnError() {
        return (IntegrationContext context) -> {
            Object code = context.getInBoundVariables().get("errorCode");
            throw new BpmnError(code != null ? String.valueOf(code) : "CONNECTOR_ERROR", "bpmn error from connector");
        };
    }

    /**
     * {@code inventory.RESERVE} (C20 order fulfilment): inbound {@code sku} (string) and {@code quantity} (integer). Outbound
     * {@code reservationId} ({@code "RES-<sku>"}), {@code reservedQuantity} (the quantity) and {@code reserved} ({@code true}).
     */
    @Bean(name = "inventory.RESERVE")
    public Connector inventoryReserve() {
        return context -> {
            Map<String, Object> inbound = context.getInBoundVariables();
            context.addOutBoundVariable("reservationId", "RES-" + inbound.get("sku"));
            context.addOutBoundVariable("reservedQuantity", inbound.get("quantity"));
            context.addOutBoundVariable("reserved", true);
            return context;
        };
    }

    /**
     * {@code payment.CHARGE} (C20 order fulfilment): inbound {@code orderId} (string), {@code amount} (integer) and
     * {@code cardToken} (string). A card token {@code DECLINED} throws {@code BpmnError("PAYMENT_DECLINED")} (the task has no
     * normal outcome then); otherwise outbound {@code paymentId} ({@code "PAY-<orderId>"}) and {@code chargedAmount} (the amount).
     */
    @Bean(name = "payment.CHARGE")
    public Connector paymentCharge() {
        return context -> {
            Map<String, Object> inbound = context.getInBoundVariables();
            if ("DECLINED".equals(inbound.get("cardToken"))) {
                throw new BpmnError("PAYMENT_DECLINED", "the card was declined");
            }
            context.addOutBoundVariable("paymentId", "PAY-" + inbound.get("orderId"));
            context.addOutBoundVariable("chargedAmount", inbound.get("amount"));
            return context;
        };
    }

    /**
     * {@code shipping.CREATE} (C20 order fulfilment): inbound {@code orderId} (string) and {@code address} (string). Outbound
     * {@code trackingNumber} ({@code "TRK-<orderId>"}) and {@code labelCreated} ({@code true}).
     */
    @Bean(name = "shipping.CREATE")
    public Connector shippingCreate() {
        return context -> {
            context.addOutBoundVariable("trackingNumber", "TRK-" + context.getInBoundVariables().get("orderId"));
            context.addOutBoundVariable("labelCreated", true);
            return context;
        };
    }

    /**
     * {@code flags.EXECUTE}: reports what the connector can see about its call. Outbound {@code ephemeral} is
     * {@code IntegrationContext.hasEphemeralVariables()} (true when the element's mapping is marked
     * {@code "ephemeral": true}), {@code connectorType} the {@code implementation} of the service task and
     * {@code clientId} the id of the service task.
     */
    @Bean(name = "flags.EXECUTE")
    public Connector flags() {
        return context -> {
            context.addOutBoundVariable("ephemeral", context.hasEphemeralVariables());
            context.addOutBoundVariable("connectorType", context.getConnectorType());
            context.addOutBoundVariable("clientId", context.getClientId());
            return context;
        };
    }
}
