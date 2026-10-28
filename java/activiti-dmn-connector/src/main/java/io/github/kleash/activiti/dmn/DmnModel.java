package io.github.kleash.activiti.dmn;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.SAXException;

/**
 * Engine-neutral, read-only view of a DMN document: which decisions exist, how they require each other, and the
 * shape of their decision tables (hit policy, aggregation, output columns, rule IDs).
 *
 * <p>The view is built with a plain namespace-aware DOM parse, so it works for DMN 1.1, 1.2 and 1.3 documents and
 * does not depend on either evaluation engine. It is what the connector uses to find the <em>sink</em> decision of a
 * file, to order the decisions of a DRD, to know whether a decision returns one result or a list, and to read the
 * {@code outputValues} that PRIORITY and OUTPUT ORDER need.
 */
public final class DmnModel {

    /** What a decision is made of. */
    public enum Kind {
        /** A decision table. */
        DECISION_TABLE,
        /** A literal FEEL expression. */
        LITERAL_EXPRESSION,
        /** Any other boxed expression (context, invocation, list, relation, function, ...). */
        OTHER_BOXED_EXPRESSION,
        /** The decision has no decision logic. */
        NONE
    }

    /**
     * One output column of a decision table.
     *
     * @param id               the column's {@code id}
     * @param name             the column's {@code name}, empty when missing
     * @param typeRef          the declared FEEL type, or {@code null}
     * @param outputValuesText the text of {@code outputValues}, or {@code null} when the column has none
     */
    public record OutputInfo(String id, String name, String typeRef, String outputValuesText) {
    }

    /**
     * One decision of the document.
     *
     * @param id                    the decision id (what the modeler writes into {@code _activiti_dmn_table_})
     * @param name                  the decision name
     * @param variableName          the name of the decision's {@code <variable>}, or {@code null}
     * @param requiredDecisionIds   ids of the decisions this one requires through {@code informationRequirement}
     * @param requiredInputIds      ids of the {@code inputData} elements it requires
     * @param requiresKnowledge     whether it has a {@code knowledgeRequirement} (business knowledge model or decision service)
     * @param kind                  what the decision logic is
     * @param expressionElement     the local name of the decision logic element, or {@code null}
     * @param hitPolicy             the hit policy for decision tables, otherwise {@code null}
     * @param aggregation           the aggregation for COLLECT tables, otherwise {@link DmnAggregation#NONE}
     * @param inputCount            number of input columns of a decision table
     * @param outputs               output columns of a decision table, in column order
     * @param ruleIds               rule ids of a decision table in rule order; a missing id is replaced by
     *                              {@code <decisionId>_rule<1-based index>}
     */
    public record DecisionInfo(
        String id,
        String name,
        String variableName,
        List<String> requiredDecisionIds,
        List<String> requiredInputIds,
        boolean requiresKnowledge,
        Kind kind,
        String expressionElement,
        DmnHitPolicy hitPolicy,
        DmnAggregation aggregation,
        int inputCount,
        List<OutputInfo> outputs,
        List<String> ruleIds) {

        /** @return {@code true} when the decision is a decision table */
        public boolean isTable() {
            return kind == Kind.DECISION_TABLE;
        }

        /**
         * Whether the decision yields a list of results (COLLECT without aggregator, RULE ORDER, OUTPUT ORDER) as
         * opposed to at most one result row.
         *
         * @return {@code true} for multi-result decision tables
         */
        public boolean isMultiResult() {
            if (!isTable()) {
                return false;
            }
            return switch (hitPolicy) {
                case RULE_ORDER, OUTPUT_ORDER -> true;
                case COLLECT -> aggregation == DmnAggregation.NONE;
                default -> false;
            };
        }

        /** @return the name the decision's result is known by to other decisions: the variable name, else the decision name */
        public String resultName() {
            return variableName != null && !variableName.isBlank() ? variableName : name;
        }
    }

    private static final Set<String> BOXED_EXPRESSIONS = Set.of(
        "decisionTable", "literalExpression", "context", "invocation", "list", "relation", "functionDefinition",
        "conditional", "filter", "for", "every", "some", "unaryTests", "expression");

    private final String definitionsId;
    private final String definitionsName;
    private final String namespace;
    private final Map<String, DecisionInfo> decisions;
    private final Set<String> businessKnowledgeModelIds;

    private DmnModel(String definitionsId, String definitionsName, String namespace,
                     Map<String, DecisionInfo> decisions, Set<String> businessKnowledgeModelIds) {
        this.definitionsId = definitionsId;
        this.definitionsName = definitionsName;
        this.namespace = namespace;
        this.decisions = Collections.unmodifiableMap(decisions);
        this.businessKnowledgeModelIds = Collections.unmodifiableSet(businessKnowledgeModelIds);
    }

    /**
     * Reads the structure of a DMN document.
     *
     * @param xml the DMN XML
     * @return the model view
     * @throws DmnModelException when the XML is not well formed or is not a DMN {@code definitions} document
     */
    public static DmnModel parse(String xml) {
        Document document = readXml(xml);
        Element root = document.getDocumentElement();
        if (!"definitions".equals(root.getLocalName())) {
            throw new DmnModelException("Not a DMN document: the root element is '" + root.getLocalName()
                + "', expected 'definitions'");
        }
        Map<String, DecisionInfo> decisions = new LinkedHashMap<>();
        Set<String> bkms = new LinkedHashSet<>();
        for (Element child : children(root)) {
            switch (child.getLocalName()) {
                case "decision" -> {
                    DecisionInfo info = readDecision(child);
                    if (decisions.put(info.id(), info) != null) {
                        throw new DmnModelException("Duplicate decision id '" + info.id() + "'");
                    }
                }
                case "businessKnowledgeModel" -> bkms.add(child.getAttribute("id"));
                default -> { }
            }
        }
        return new DmnModel(root.getAttribute("id"), root.getAttribute("name"), root.getAttribute("namespace"),
            decisions, bkms);
    }

    /** @return the {@code definitions/@id} (empty when missing) */
    public String definitionsId() {
        return definitionsId;
    }

    /** @return the {@code definitions/@name} (empty when missing) */
    public String definitionsName() {
        return definitionsName;
    }

    /** @return the {@code definitions/@namespace} (empty when missing) */
    public String namespace() {
        return namespace;
    }

    /** @return all decisions in document order */
    public List<DecisionInfo> decisions() {
        return List.copyOf(decisions.values());
    }

    /**
     * Looks a decision up by id.
     *
     * @param id the decision id
     * @return the decision, if the document has one with that id
     */
    public Optional<DecisionInfo> decision(String id) {
        return Optional.ofNullable(decisions.get(id));
    }

    /** @return the ids of the business knowledge models of the document */
    public Set<String> businessKnowledgeModelIds() {
        return businessKnowledgeModelIds;
    }

    /**
     * The decisions that no other decision of the file requires. A single-decision file or a DRD with one final
     * decision has exactly one sink.
     *
     * @return the sink decisions in document order
     */
    public List<DecisionInfo> sinkDecisions() {
        Set<String> required = new HashSet<>();
        decisions.values().forEach(d -> required.addAll(d.requiredDecisionIds()));
        return decisions.values().stream().filter(d -> !required.contains(d.id())).toList();
    }

    /**
     * The one sink decision of the document.
     *
     * @return the sink
     * @throws DmnResolutionException when the document has no decision, or several decisions that nothing requires
     *                                (then the caller must name the decision by id)
     */
    public DecisionInfo sink() {
        List<DecisionInfo> sinks = sinkDecisions();
        if (sinks.size() == 1) {
            return sinks.get(0);
        }
        if (sinks.isEmpty()) {
            throw new DmnResolutionException("The DMN document has no decision that is not required by another one"
                + (decisions.isEmpty() ? " (it defines no decision)" : " (the decision requirements form a cycle)"));
        }
        throw new DmnResolutionException("The DMN document has " + sinks.size() + " final decisions "
            + sinks.stream().map(DecisionInfo::id).toList() + "; reference one of them by decision id");
    }

    /**
     * Selects a decision inside this one document: {@code null} selects the {@linkplain #sink() sink}; otherwise the
     * reference is a decision id, or the {@code definitions/@name} (which selects the sink).
     *
     * @param decisionRef a decision id, the definitions name, or {@code null}
     * @return the selected decision
     * @throws DmnResolutionException when nothing, or no unique decision, is selected
     */
    public DecisionInfo select(String decisionRef) {
        if (decisionRef == null || decisionRef.isBlank()) {
            return sink();
        }
        DecisionInfo byId = decisions.get(decisionRef);
        if (byId != null) {
            return byId;
        }
        if (decisionRef.equals(definitionsName)) {
            return sink();
        }
        throw new DmnResolutionException("Decision '" + decisionRef + "' not found in the DMN document; decision ids: "
            + decisions.keySet());
    }

    /**
     * The decision and everything it requires, dependencies first, the requested decision last.
     *
     * @param decisionId the decision to evaluate
     * @return the evaluation order
     * @throws DmnModelException when a required decision is missing or the requirements form a cycle
     */
    public List<DecisionInfo> evaluationOrder(String decisionId) {
        List<DecisionInfo> order = new ArrayList<>();
        visit(decisionId, new LinkedHashSet<>(), new HashSet<>(), order);
        return order;
    }

    private void visit(String id, Set<String> path, Set<String> done, List<DecisionInfo> order) {
        if (done.contains(id)) {
            return;
        }
        DecisionInfo decision = decisions.get(id);
        if (decision == null) {
            throw new DmnModelException("Decision '" + id + "' is required but not defined in the document"
                + (path.isEmpty() ? "" : " (required by '" + String.join("' -> '", path) + "')"));
        }
        if (!path.add(id)) {
            throw new DmnModelException("Decision requirements form a cycle: " + String.join(" -> ", path) + " -> " + id);
        }
        for (String required : decision.requiredDecisionIds()) {
            visit(required, path, done, order);
        }
        path.remove(id);
        done.add(id);
        order.add(decision);
    }

    private static DecisionInfo readDecision(Element decision) {
        String id = decision.getAttribute("id");
        if (id.isBlank()) {
            throw new DmnModelException("A decision (name '" + decision.getAttribute("name") + "') has no id");
        }
        String variable = null;
        List<String> requiredDecisions = new ArrayList<>();
        List<String> requiredInputs = new ArrayList<>();
        boolean knowledge = false;
        Kind kind = Kind.NONE;
        String expression = null;
        DmnHitPolicy hitPolicy = null;
        DmnAggregation aggregation = DmnAggregation.NONE;
        int inputs = 0;
        List<OutputInfo> outputs = new ArrayList<>();
        List<String> rules = new ArrayList<>();

        for (Element child : children(decision)) {
            String local = child.getLocalName();
            switch (local) {
                case "variable" -> variable = child.getAttribute("name");
                case "informationRequirement" -> {
                    for (Element requirement : children(child)) {
                        String target = fragment(requirement.getAttribute("href"));
                        if ("requiredDecision".equals(requirement.getLocalName())) {
                            requiredDecisions.add(target);
                        } else if ("requiredInput".equals(requirement.getLocalName())) {
                            requiredInputs.add(target);
                        }
                    }
                }
                case "knowledgeRequirement" -> knowledge = true;
                default -> {
                    if (BOXED_EXPRESSIONS.contains(local)) {
                        expression = local;
                        kind = switch (local) {
                            case "decisionTable" -> Kind.DECISION_TABLE;
                            case "literalExpression" -> Kind.LITERAL_EXPRESSION;
                            default -> Kind.OTHER_BOXED_EXPRESSION;
                        };
                        if (kind == Kind.DECISION_TABLE) {
                            hitPolicy = DmnHitPolicy.fromXml(child.getAttribute("hitPolicy"));
                            aggregation = DmnAggregation.fromXml(child.getAttribute("aggregation"));
                            if (aggregation != DmnAggregation.NONE && hitPolicy != DmnHitPolicy.COLLECT) {
                                throw new DmnModelException("Decision '" + id + "': aggregation " + aggregation
                                    + " is only allowed with hit policy COLLECT");
                            }
                            int ruleIndex = 0;
                            for (Element part : children(child)) {
                                switch (part.getLocalName()) {
                                    case "input" -> inputs++;
                                    case "output" -> outputs.add(readOutput(part));
                                    case "rule" -> {
                                        ruleIndex++;
                                        String ruleId = part.getAttribute("id");
                                        rules.add(ruleId.isBlank() ? id + "_rule" + ruleIndex : ruleId);
                                    }
                                    default -> { }
                                }
                            }
                        }
                    }
                }
            }
        }
        return new DecisionInfo(id, decision.getAttribute("name"), variable, List.copyOf(requiredDecisions),
            List.copyOf(requiredInputs), knowledge, kind, expression, hitPolicy, aggregation, inputs,
            List.copyOf(outputs), List.copyOf(rules));
    }

    private static OutputInfo readOutput(Element output) {
        String values = null;
        for (Element child : children(output)) {
            if ("outputValues".equals(child.getLocalName())) {
                for (Element text : children(child)) {
                    if ("text".equals(text.getLocalName())) {
                        values = text.getTextContent();
                    }
                }
            }
        }
        String typeRef = output.hasAttribute("typeRef") ? output.getAttribute("typeRef") : null;
        return new OutputInfo(output.getAttribute("id"), output.getAttribute("name"), typeRef, values);
    }

    private static String fragment(String href) {
        int hash = href.indexOf('#');
        return hash >= 0 ? href.substring(hash + 1) : href;
    }

    /**
     * Child elements of an element.
     *
     * @param parent the element
     * @return its element children in document order
     */
    static List<Element> children(Element parent) {
        List<Element> result = new ArrayList<>();
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node instanceof Element element) {
                result.add(element);
            }
        }
        return result;
    }

    /**
     * Parses XML into a DOM tree with external entities and DOCTYPEs disabled.
     *
     * @param xml the XML text
     * @return the parsed document
     * @throws DmnModelException when the XML is not well formed
     */
    static Document readXml(String xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
        } catch (ParserConfigurationException e) {
            throw new IllegalStateException("The JDK XML parser does not support the required security features", e);
        } catch (SAXException | IOException e) {
            throw new DmnModelException("The DMN document is not well formed XML: " + e.getMessage(), e);
        }
    }
}
