package io.github.kleash.activiti.harness.support;

import java.util.LinkedHashMap;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.spring.process.ProcessExtensionService;
import org.activiti.spring.process.model.Extension;
import org.activiti.spring.process.model.VariableDefinition;

/**
 * Bean {@code extensionInspector}: shows what the runtime's own reader made of the {@code -extensions.json} property
 * definitions of the running process, so that metadata with no runtime effect (description, display name, display,
 * analytics, ephemeral) can be asserted. {@code ${extensionInspector.all(execution)}} (with a result variable) returns, for
 * every property name, a map with {@code type}, {@code required}, {@code hasDefault}, {@code description},
 * {@code displayName}, {@code display}, {@code analytics} and {@code ephemeral}.
 */
public class ExtensionInspector {

    private final ProcessExtensionService extensions;

    public ExtensionInspector(ProcessExtensionService extensions) {
        this.extensions = extensions;
    }

    public LinkedHashMap<String, Object> all(DelegateExecution execution) {
        Extension extension = extensions.getExtensionsForId(execution.getProcessDefinitionId());
        LinkedHashMap<String, Object> out = new LinkedHashMap<>();
        for (VariableDefinition definition : extension.getProperties().values()) {
            LinkedHashMap<String, Object> description = new LinkedHashMap<>();
            description.put("type", definition.getType());
            description.put("required", definition.isRequired());
            description.put("hasDefault", definition.getValue() != null);
            description.put("description", definition.getDescription());
            description.put("displayName", definition.getDisplayName());
            description.put("display", definition.getDisplay());
            description.put("analytics", definition.isAnalytics());
            description.put("ephemeral", definition.isEphemeral());
            out.put(definition.getName(), description);
        }
        return out;
    }
}
