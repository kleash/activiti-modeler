package io.github.kleash.activiti.scenario.model;

import java.util.List;
import java.util.Map;

/**
 * Parsed {@code model-expect.json}: static element-attribute expectations per process.
 *
 * @param processes process id to its expectations, in file order
 */
public record ModelExpectations(Map<String, ProcessExpectation> processes) {

    /**
     * @param definition        expected ProcessDefinition properties, or {@code null}
     * @param process           expected parsed Process properties, or {@code null}
     * @param starterUsers      exact set of candidate starter users, or {@code null} when not asserted
     * @param starterGroups     exact set of candidate starter groups, or {@code null} when not asserted
     * @param extensions        expectations on the process extensions ({@code -extensions.json}) as the runtime's reader parsed
     *                          them, or {@code null}
     * @param elements          element id to expectation, in file order
     */
    public record ProcessExpectation(
            Map<String, Object> definition,
            Map<String, Object> process,
            List<String> starterUsers,
            List<String> starterGroups,
            ExtensionsExpectation extensions,
            Map<String, ElementExpectation> elements) {
        public ProcessExpectation {
            elements = elements == null ? Map.of() : elements;
        }
    }

    /**
     * Expectations on the {@code org.activiti.spring.process.model.Extension} of a process.
     *
     * @param properties property name to the expected properties of its {@code VariableDefinition} (type, required, value, ...)
     * @param mappings   element id to the expected properties of its {@code ProcessVariablesMapping}
     *                   (mappingType, ephemeral, inputs, outputs; each mapping has type and value)
     * @param constants  element id to the expected constants: name to value
     */
    public record ExtensionsExpectation(
            Map<String, Object> properties,
            Map<String, Object> mappings,
            Map<String, Object> constants) {
    }

    /**
     * @param type       XML element name of the parsed element, or {@code null}
     * @param attributes bean property to expected value, or {@code null}
     */
    public record ElementExpectation(String type, Map<String, Object> attributes) {
    }
}
