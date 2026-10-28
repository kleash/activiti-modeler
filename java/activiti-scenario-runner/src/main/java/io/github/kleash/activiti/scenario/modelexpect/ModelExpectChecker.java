package io.github.kleash.activiti.scenario.modelexpect;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.activiti.bpmn.model.AdhocSubProcess;
import org.activiti.bpmn.model.BpmnModel;
import org.activiti.bpmn.model.DataObject;
import org.activiti.bpmn.model.EventGateway;
import org.activiti.bpmn.model.EventSubProcess;
import org.activiti.bpmn.model.ThrowEvent;
import org.activiti.bpmn.model.FlowElement;
import org.activiti.bpmn.model.FlowNode;
import org.activiti.bpmn.model.Process;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.ProcessDefinition;
import org.activiti.engine.task.IdentityLink;
import org.activiti.engine.task.IdentityLinkType;
import org.activiti.spring.process.ProcessExtensionService;
import org.activiti.spring.process.model.ConstantDefinition;
import org.activiti.spring.process.model.Extension;
import org.activiti.spring.process.model.ProcessConstantsMapping;
import org.activiti.spring.process.model.VariableDefinition;
import org.springframework.beans.BeanWrapper;
import org.springframework.beans.BeanWrapperImpl;

import io.github.kleash.activiti.scenario.match.ValueMatcher;
import io.github.kleash.activiti.scenario.model.ModelExpectations;

/**
 * Checks {@code model-expect.json}: element-attribute expectations without a runtime effect, evaluated against the
 * {@link BpmnModel} the engine parsed from the deployed resources (so they prove what the <em>engine</em> understood,
 * not what the file says), against the process definition's identity links for candidate starters and, for the
 * {@code extensions} section, against the {@link Extension} the runtime's own reader made of {@code -extensions.json}
 * (properties by name, mappings and constants by element id).
 */
public final class ModelExpectChecker {

    private final RepositoryService repository;
    private final ProcessExtensionService extensionService;

    public ModelExpectChecker(RepositoryService repository) {
        this(repository, null);
    }

    /** @param extensionService reads the process extensions; {@code null} when the runtime has none (an {@code extensions} expectation then fails) */
    public ModelExpectChecker(RepositoryService repository, ProcessExtensionService extensionService) {
        this.repository = repository;
        this.extensionService = extensionService;
    }

    /** @return one message per violated expectation; empty when the model matches */
    public List<String> check(ModelExpectations expectations) {
        List<String> problems = new ArrayList<>();
        expectations.processes().forEach((key, expected) -> checkProcess(key, expected, problems));
        return problems;
    }

    private void checkProcess(String key, ModelExpectations.ProcessExpectation expected, List<String> problems) {
        ProcessDefinition definition = repository.createProcessDefinitionQuery().processDefinitionKey(key).latestVersion().singleResult();
        if (definition == null) {
            problems.add("process '" + key + "': no process definition with this key is deployed");
            return;
        }
        BpmnModel model = repository.getBpmnModel(definition.getId());
        Process process = model.getProcessById(key);
        if (expected.definition() != null) {
            problems.addAll(matchBean("process '" + key + "' definition", expected.definition(), definition));
        }
        if (expected.process() != null) {
            problems.addAll(matchBean("process '" + key + "'", expected.process(), process));
        }
        if (expected.starterUsers() != null || expected.starterGroups() != null) {
            checkStarters(key, definition, expected, problems);
        }
        if (expected.extensions() != null) {
            checkExtensions(key, definition, expected.extensions(), problems);
        }
        expected.elements().forEach((id, element) -> checkElement(key, process, id, element, problems));
    }

    private void checkExtensions(String key, ProcessDefinition definition, ModelExpectations.ExtensionsExpectation expected, List<String> problems) {
        String label = "process '" + key + "' extensions";
        if (extensionService == null) {
            problems.add(label + ": no ProcessExtensionService is available to read the extensions");
            return;
        }
        Extension extension = extensionService.getExtensionsForId(definition.getId());
        if (expected.properties() != null) {
            Map<String, VariableDefinition> byName = new LinkedHashMap<>();
            extension.getProperties().values().forEach(v -> byName.put(v.getName(), v));
            problems.addAll(matchEntries(label + ".properties", expected.properties(), byName, false));
        }
        if (expected.mappings() != null) {
            problems.addAll(matchEntries(label + ".mappings", expected.mappings(), extension.getMappings(), false));
        }
        if (expected.constants() != null) {
            Map<String, Map<String, Object>> plain = new LinkedHashMap<>();
            extension.getConstants().forEach((element, constants) -> plain.put(element, constantValues(constants)));
            problems.addAll(matchEntries(label + ".constants", expected.constants(), plain, true));
        }
    }

    private static Map<String, Object> constantValues(ProcessConstantsMapping constants) {
        Map<String, Object> values = new LinkedHashMap<>();
        for (Map.Entry<String, ConstantDefinition> c : constants.entrySet()) {
            values.put(c.getKey(), c.getValue().getValue());
        }
        return values;
    }

    /**
     * Compares each expected entry with the entry of the same key (a bean or a map); an entry that does not exist is
     * "absent" for the matcher, so {@code {"$exists": false}} asserts that there is none. With {@code exact} an object
     * expectation must list every key of the entry (the constants of an element); otherwise only the listed properties
     * of the bean are compared.
     */
    private List<String> matchEntries(String label, Map<String, Object> expected, Map<String, ?> actual, boolean exact) {
        List<String> problems = new ArrayList<>();
        for (Map.Entry<String, Object> e : expected.entrySet()) {
            String entryLabel = label + "." + e.getKey();
            if (!actual.containsKey(e.getKey())) {
                problems.addAll(ValueMatcher.match(entryLabel, e.getValue(), ValueMatcher.ABSENT));
            } else if (!exact && e.getValue() instanceof Map<?, ?> em && !ValueMatcher.isMatcher(e.getValue())) {
                @SuppressWarnings("unchecked")
                Map<String, Object> expectedProperties = (Map<String, Object>) em;
                problems.addAll(matchBean(entryLabel, expectedProperties, actual.get(e.getKey())));
            } else {
                problems.addAll(ValueMatcher.match(entryLabel, e.getValue(), project(e.getValue(), actual.get(e.getKey()))));
            }
        }
        return problems;
    }

    private void checkStarters(String key, ProcessDefinition definition, ModelExpectations.ProcessExpectation expected, List<String> problems) {
        Set<String> users = new TreeSet<>();
        Set<String> groups = new TreeSet<>();
        for (IdentityLink link : repository.getIdentityLinksForProcessDefinition(definition.getId())) {
            if (IdentityLinkType.CANDIDATE.equals(link.getType())) {
                if (link.getUserId() != null) {
                    users.add(link.getUserId());
                }
                if (link.getGroupId() != null) {
                    groups.add(link.getGroupId());
                }
            }
        }
        if (expected.starterUsers() != null && !new TreeSet<>(expected.starterUsers()).equals(users)) {
            problems.add("process '" + key + "' candidateStarters.users: expected exactly " + new TreeSet<>(expected.starterUsers()) + " but identity links give " + users);
        }
        if (expected.starterGroups() != null && !new TreeSet<>(expected.starterGroups()).equals(groups)) {
            problems.add("process '" + key + "' candidateStarters.groups: expected exactly " + new TreeSet<>(expected.starterGroups()) + " but identity links give " + groups);
        }
    }

    private void checkElement(String key, Process process, String id, ModelExpectations.ElementExpectation expected, List<String> problems) {
        String label = "process '" + key + "' element '" + id + "'";
        FlowElement element = process.getFlowElement(id, true);
        if (element == null) {
            problems.add(label + ": no such element in the parsed model");
            return;
        }
        if (expected.type() != null) {
            String actual = typeName(element);
            if (!expected.type().equals(actual)) {
                problems.add(label + ".type: expected " + expected.type() + " but the engine parsed a " + actual);
            }
        }
        if (expected.attributes() != null) {
            problems.addAll(matchBean(label, expected.attributes(), element));
        }
    }

    /**
     * The XML element name of a parsed element: the decapitalized simple class name, except for the classes whose name
     * differs from the element ({@code EventGateway} is {@code eventBasedGateway}, {@code ThrowEvent} is
     * {@code intermediateThrowEvent}, the typed data objects are {@code dataObject}, ...).
     */
    static String typeName(Object element) {
        return switch (element) {
            case EventGateway g -> "eventBasedGateway";
            case EventSubProcess e -> "subProcess";
            case AdhocSubProcess a -> "adHocSubProcess";
            case DataObject d -> "dataObject";
            case ThrowEvent t -> "intermediateThrowEvent";
            default -> {
                String simple = element.getClass().getSimpleName();
                yield Character.toLowerCase(simple.charAt(0)) + simple.substring(1);
            }
        };
    }

    private List<String> matchBean(String label, Map<String, Object> expected, Object bean) {
        List<String> problems = new ArrayList<>();
        for (Map.Entry<String, Object> e : expected.entrySet()) {
            Object actual = property(bean, e.getKey());
            Object projected = actual == MISSING ? ValueMatcher.ABSENT : project(e.getValue(), actual);
            if (actual == MISSING) {
                problems.add(label + "." + e.getKey() + ": " + bean.getClass().getSimpleName() + " has no readable property '" + e.getKey() + "'");
            } else {
                problems.addAll(ValueMatcher.match(label + "." + e.getKey(), e.getValue(), projected));
            }
        }
        return problems;
    }

    // ---- projection of bean graphs onto what the expectation mentions ----------------------------------------------------

    private static final Object MISSING = new Object();

    /**
     * Reads {@code name} from a bean (or map). Understands the aliases {@code exclusive} and {@code async} for flow
     * nodes and the pseudo property {@code @class} (simple class name).
     */
    private static Object property(Object target, String name) {
        if (target == null) {
            return MISSING;
        }
        if ("@class".equals(name)) {
            return target.getClass().getSimpleName();
        }
        if (target instanceof Map<?, ?> map) {
            return map.containsKey(name) ? map.get(name) : MISSING;
        }
        if (target instanceof FlowNode node) {
            if ("exclusive".equals(name)) {
                return !node.isNotExclusive();
            }
            if ("async".equals(name)) {
                return node.isAsynchronous();
            }
        }
        BeanWrapper wrapper = new BeanWrapperImpl(target);
        return wrapper.isReadableProperty(name) ? wrapper.getPropertyValue(name) : MISSING;
    }

    /**
     * Reduces {@code actual} to what {@code expected} talks about: for an object expectation only the mentioned
     * properties, for an array expectation each element likewise; everything else to a plain value.
     */
    private static Object project(Object expected, Object actual) {
        if (ValueMatcher.isMatcher(expected)) {
            return plain(actual);
        }
        if (expected instanceof Map<?, ?> em) {
            if (actual == null) {
                return null;
            }
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : em.entrySet()) {
                String name = String.valueOf(e.getKey());
                Object value = property(actual, name);
                if (value != MISSING) {
                    out.put(name, project(e.getValue(), value));
                }
            }
            return out;
        }
        if (expected instanceof List<?> el) {
            if (!(actual instanceof Iterable<?> items)) {
                return plain(actual);
            }
            List<Object> out = new ArrayList<>();
            int i = 0;
            for (Object item : items) {
                out.add(i < el.size() ? project(el.get(i), item) : plain(item));
                i++;
            }
            return out;
        }
        return plain(actual);
    }

    private static Object plain(Object actual) {
        if (actual == null || actual instanceof String || actual instanceof Number || actual instanceof Boolean || actual instanceof Date) {
            return actual;
        }
        if (actual instanceof Enum<?> e) {
            return e.name();
        }
        if (actual instanceof Iterable<?> items) {
            List<Object> out = new ArrayList<>();
            items.forEach(item -> out.add(plain(item)));
            return out;
        }
        if (actual instanceof Map<?, ?> map) {
            Map<String, Object> out = new LinkedHashMap<>();
            map.forEach((k, v) -> out.put(String.valueOf(k), plain(v)));
            return out;
        }
        return String.valueOf(actual);
    }
}
