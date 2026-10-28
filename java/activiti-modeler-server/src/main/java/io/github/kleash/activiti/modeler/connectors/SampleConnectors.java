package io.github.kleash.activiti.modeler.connectors;

import java.util.LinkedHashMap;
import java.util.Map;

import org.activiti.api.process.model.IntegrationContext;
import org.activiti.api.process.runtime.connector.Connector;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Connectors the modeler server ships so that a model with a connector service task runs without writing Java. A connector is a bean
 * named {@code <connector>.<ACTION>}; a service task names it as {@code implementation="echo.EXECUTE"}. The runner's recording wrapper
 * is put around every one of them (and around {@code dmn-connector.EXECUTE_TABLE}), which is what {@code expectConnectorCall} reads.
 *
 * <ul>
 *   <li>{@code echo.EXECUTE}: returns every inbound variable unchanged, plus {@code echoCount}, the number of inbound variables.</li>
 *   <li>{@code http.GET}: a <em>mock</em> of an HTTP GET - it never touches the network. Inbound {@code url} (and optionally
 *       {@code status}, default 200); outbound {@code statusCode}, {@code body} ({@code {url, method, mock, message}}) and
 *       {@code headers}. It makes models that call a web service testable offline.</li>
 *   <li>{@code crm.LOOKUP}: inbound {@code customerId}; outbound {@code customerName} ("Customer &lt;id&gt;"), {@code tier} ("gold" when the
 *       id starts with {@code G-}, else "standard") and {@code found}.</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
public class SampleConnectors {

    @Bean(name = "echo.EXECUTE")
    public Connector echo() {
        return context -> {
            Map<String, Object> inbound = new LinkedHashMap<>(context.getInBoundVariables());
            inbound.forEach(context::addOutBoundVariable);
            context.addOutBoundVariable("echoCount", inbound.size());
            return context;
        };
    }

    @Bean(name = "http.GET")
    public Connector httpGet() {
        return context -> {
            Object url = context.getInBoundVariables().get("url");
            Object status = context.getInBoundVariables().get("status");
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("url", url);
            body.put("method", "GET");
            body.put("mock", true);
            body.put("message", "http.GET is a mock of the modeler server: no request was sent");
            context.addOutBoundVariable("statusCode", status instanceof Number n ? n.intValue() : 200);
            context.addOutBoundVariable("body", body);
            context.addOutBoundVariable("headers", Map.of("content-type", "application/json", "x-mock", "true"));
            return context;
        };
    }

    @Bean(name = "crm.LOOKUP")
    public Connector crmLookup() {
        return (IntegrationContext context) -> {
            Object id = context.getInBoundVariables().get("customerId");
            if (id == null) {
                context.addOutBoundVariable("found", false);
                return context;
            }
            String customer = String.valueOf(id);
            context.addOutBoundVariable("customerName", "Customer " + customer);
            context.addOutBoundVariable("tier", customer.startsWith("G-") ? "gold" : "standard");
            context.addOutBoundVariable("found", true);
            return context;
        };
    }
}
