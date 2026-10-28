package io.github.kleash.activiti.harness.support;

import java.util.LinkedHashMap;
import java.util.Map;

import org.activiti.engine.delegate.CustomPropertiesResolver;
import org.activiti.engine.delegate.DelegateExecution;

/**
 * Custom properties resolver for transaction-dependent listeners. The map it returns is handed to the listener as
 * {@code customPropertiesMap}: {@code resolvedBy} says how the resolver was declared and {@code activity} is the id of the
 * element the listener sits on.
 *
 * <p>Used as {@code customPropertiesResolverClass} (this class, {@code resolvedBy=class}), through the bean
 * {@code delegatePropertiesResolver} ({@code customPropertiesResolverDelegateExpression}, {@code resolvedBy=delegateExpression})
 * and through {@code propertiesFactory.resolved('expression', execution)} ({@code customPropertiesResolverExpression}).
 */
public class CorpusPropertiesResolver implements CustomPropertiesResolver {

    private final String resolvedBy;

    /** The engine instantiates the class form with this constructor. */
    public CorpusPropertiesResolver() {
        this("class");
    }

    public CorpusPropertiesResolver(String resolvedBy) {
        this.resolvedBy = resolvedBy;
    }

    @Override
    public Map<String, Object> getCustomPropertiesMap(DelegateExecution execution) {
        return describe(resolvedBy, execution);
    }

    /** The map: {@code resolvedBy} and {@code activity}. */
    public static Map<String, Object> describe(String resolvedBy, DelegateExecution execution) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("resolvedBy", resolvedBy);
        map.put("activity", execution.getCurrentFlowElement() != null ? execution.getCurrentFlowElement().getId() : null);
        return map;
    }

    /** Bean {@code propertiesFactory}: for {@code customPropertiesResolverExpression="${propertiesFactory.resolved('expression', execution)}"}. */
    public static class Factory {
        public Map<String, Object> resolved(String resolvedBy, DelegateExecution execution) {
            return describe(resolvedBy, execution);
        }
    }
}
