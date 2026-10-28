package io.github.kleash.activiti.dmn;

import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import javax.xml.XMLConstants;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;

import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * DOM rewrites applied to a DMN document before it is handed to an engine that cannot execute it as written
 * (or, for the KIE evaluator, to obtain per-rule results). Mostly helpers of the Operaton evaluator, kept separate
 * so they can be unit tested.
 */
public final class DmnDocuments {

    private static final Set<String> KEPT_DEFINITIONS_CHILDREN = Set.of("itemDefinition", "inputData", "import");

    private DmnDocuments() {
    }

    /**
     * Produces a document that contains only one decision, ready for Operaton:
     * <ul>
     *   <li>every other decision, business knowledge model and decision service is removed;</li>
     *   <li>the decision's requirements are removed (the evaluator chains decisions itself, so that PRIORITY and
     *       OUTPUT ORDER results feed dependent decisions correctly);</li>
     *   <li>hit policy PRIORITY and OUTPUT ORDER are rewritten to RULE ORDER (the evaluator orders the matched rules);</li>
     *   <li>rules without an id get {@code <decisionId>_rule<index>}, the id {@link DmnModel} reports.</li>
     * </ul>
     *
     * @param xml        the original DMN XML
     * @param decisionId the decision to keep
     * @return the rewritten XML
     */
    static String isolateDecision(String xml, String decisionId) {
        Document document = DmnModel.readXml(xml);
        Element root = document.getDocumentElement();
        Element kept = null;
        for (Element child : DmnModel.children(root)) {
            String local = child.getLocalName();
            if ("decision".equals(local) && decisionId.equals(child.getAttribute("id"))) {
                kept = child;
            } else if (!KEPT_DEFINITIONS_CHILDREN.contains(local)) {
                root.removeChild(child);
            }
        }
        if (kept == null) {
            throw new DmnModelException("Decision '" + decisionId + "' is not defined in the document");
        }
        for (Element child : new ArrayList<>(DmnModel.children(kept))) {
            switch (child.getLocalName()) {
                case "informationRequirement", "knowledgeRequirement", "authorityRequirement" -> kept.removeChild(child);
                case "decisionTable" -> rewriteTable(child, decisionId);
                default -> { }
            }
        }
        return serialize(document);
    }

    /**
     * Rewrites the hit policy of one decision table.
     *
     * @param xml        the DMN XML
     * @param decisionId the decision whose table is rewritten
     * @param policy     the new hit policy
     * @return the rewritten XML; every other part of the document is unchanged
     * @throws DmnModelException when the decision does not exist or has no decision table
     */
    public static String withHitPolicy(String xml, String decisionId, DmnHitPolicy policy) {
        Document document = DmnModel.readXml(xml);
        for (Element decision : DmnModel.children(document.getDocumentElement())) {
            if ("decision".equals(decision.getLocalName()) && decisionId.equals(decision.getAttribute("id"))) {
                for (Element child : DmnModel.children(decision)) {
                    if ("decisionTable".equals(child.getLocalName())) {
                        child.setAttribute("hitPolicy", policy.xmlName());
                        return serialize(document);
                    }
                }
            }
        }
        throw new DmnModelException("Decision '" + decisionId + "' has no decision table to rewrite");
    }

    private static void rewriteTable(Element table, String decisionId) {
        DmnHitPolicy policy = DmnHitPolicy.fromXml(table.getAttribute("hitPolicy"));
        if (policy.ordersByOutputValues()) {
            table.setAttribute("hitPolicy", DmnHitPolicy.RULE_ORDER.xmlName());
        }
        int index = 0;
        for (Element child : DmnModel.children(table)) {
            if ("rule".equals(child.getLocalName())) {
                index++;
                if (child.getAttribute("id").isBlank()) {
                    child.setAttribute("id", decisionId + "_rule" + index);
                }
            }
        }
    }

    private static String serialize(Document document) {
        try {
            TransformerFactory factory = TransformerFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            Transformer transformer = factory.newTransformer();
            transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
            StringWriter out = new StringWriter();
            transformer.transform(new DOMSource(document), new StreamResult(out));
            return out.toString();
        } catch (TransformerException e) {
            throw new DmnModelException("Cannot rewrite the DMN document: " + e.getMessage(), e);
        }
    }

    /**
     * Lists the local names of the elements directly under {@code definitions}; used by tests.
     *
     * @param xml DMN XML
     * @return local element names
     */
    static List<String> definitionsChildren(String xml) {
        return DmnModel.children(DmnModel.readXml(xml).getDocumentElement()).stream().map(Element::getLocalName).toList();
    }
}
