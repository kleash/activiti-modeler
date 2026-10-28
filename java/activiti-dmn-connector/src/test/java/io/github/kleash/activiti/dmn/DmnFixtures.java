package io.github.kleash.activiti.dmn;

import java.util.ArrayList;
import java.util.List;

/**
 * Builds small DMN 1.3 documents that follow the portable conventions of docs/user-guide/dmn-conventions.md
 * (DMN 1.3 namespace, FEEL type names, {@code <variable>} on every decision, declared {@code inputData}, {@code -} for
 * "any"), so the same document evaluates on Operaton and on KIE.
 */
public final class DmnFixtures {

    private DmnFixtures() {
    }

    /**
     * An input column and the input data node it reads.
     *
     * @param name the variable name (also the input expression)
     * @param type the FEEL type
     */
    public record In(String name, String type) {
    }

    /**
     * An output column.
     *
     * @param name   the output name
     * @param type   the FEEL type
     * @param values the {@code outputValues} text, or {@code null}
     */
    public record Out(String name, String type, String values) {
    }

    /**
     * A rule.
     *
     * @param id      the rule id
     * @param inputs  one input entry per input column
     * @param outputs one output entry per output column
     */
    public record Rule(String id, List<String> inputs, List<String> outputs) {
    }

    /**
     * Shorthand for a rule with one input and one output.
     *
     * @param id     rule id
     * @param input  input entry
     * @param output output entry
     * @return the rule
     */
    public static Rule rule(String id, String input, String output) {
        return new Rule(id, List.of(input), List.of(output));
    }

    /**
     * Shorthand for a rule.
     *
     * @param id      rule id
     * @param inputs  input entries
     * @param outputs output entries
     * @return the rule
     */
    public static Rule rule(String id, List<String> inputs, List<String> outputs) {
        return new Rule(id, inputs, outputs);
    }

    private static String esc(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /**
     * A decision table element (without the surrounding {@code decision}).
     *
     * @param id          decision id
     * @param hitPolicy   hit policy text, for example {@code RULE ORDER}
     * @param aggregation aggregation or {@code null}
     * @param inputs      input columns
     * @param outputs     output columns
     * @param rules       the rules
     * @return the {@code decisionTable} XML
     */
    public static String tableXml(String id, String hitPolicy, String aggregation, List<In> inputs, List<Out> outputs, List<Rule> rules) {
        StringBuilder xml = new StringBuilder();
        xml.append("    <decisionTable id=\"").append(id).append("_table\" hitPolicy=\"").append(hitPolicy).append('"');
        if (aggregation != null) {
            xml.append(" aggregation=\"").append(aggregation).append('"');
        }
        xml.append(">\n");
        for (int i = 0; i < inputs.size(); i++) {
            xml.append("      <input id=\"").append(id).append("_in").append(i).append("\"><inputExpression id=\"")
                .append(id).append("_ie").append(i).append("\" typeRef=\"").append(inputs.get(i).type()).append("\"><text>")
                .append(esc(inputs.get(i).name())).append("</text></inputExpression></input>\n");
        }
        for (int i = 0; i < outputs.size(); i++) {
            Out out = outputs.get(i);
            xml.append("      <output id=\"").append(id).append("_out").append(i).append("\" name=\"").append(out.name())
                .append("\" typeRef=\"").append(out.type()).append('"');
            if (out.values() == null) {
                xml.append(" />\n");
            } else {
                xml.append("><outputValues id=\"").append(id).append("_ov").append(i).append("\"><text>")
                    .append(esc(out.values())).append("</text></outputValues></output>\n");
            }
        }
        for (Rule rule : rules) {
            xml.append("      <rule id=\"").append(rule.id()).append("\">");
            for (String entry : rule.inputs()) {
                xml.append("<inputEntry><text>").append(esc(entry)).append("</text></inputEntry>");
            }
            for (String entry : rule.outputs()) {
                xml.append("<outputEntry><text>").append(esc(entry)).append("</text></outputEntry>");
            }
            xml.append("</rule>\n");
        }
        xml.append("    </decisionTable>\n");
        return xml.toString();
    }

    /**
     * A decision element.
     *
     * @param id        decision id (also its name and variable name)
     * @param type      type of the decision variable, or {@code null}
     * @param requires  ids of required decisions
     * @param inputs    names of required input data
     * @param logicXml  the decision logic element
     * @return the {@code decision} XML
     */
    public static String decisionXml(String id, String type, List<String> requires, List<String> inputs, String logicXml) {
        StringBuilder xml = new StringBuilder();
        xml.append("  <decision id=\"").append(id).append("\" name=\"").append(id).append("\">\n");
        xml.append("    <variable id=\"").append(id).append("_var\" name=\"").append(id).append('"');
        if (type != null) {
            xml.append(" typeRef=\"").append(type).append('"');
        }
        xml.append(" />\n");
        for (String required : requires) {
            xml.append("    <informationRequirement id=\"").append(id).append("_req_").append(required)
                .append("\"><requiredDecision href=\"#").append(required).append("\" /></informationRequirement>\n");
        }
        for (String input : inputs) {
            xml.append("    <informationRequirement id=\"").append(id).append("_reqin_").append(input)
                .append("\"><requiredInput href=\"#in_").append(input).append("\" /></informationRequirement>\n");
        }
        xml.append(logicXml).append("  </decision>\n");
        return xml.toString();
    }

    /**
     * A complete document.
     *
     * @param definitionsName the {@code definitions/@name}
     * @param inputData       declared input data nodes
     * @param decisions       the {@code decision} elements
     * @return the DMN XML
     */
    public static String document(String definitionsName, List<In> inputData, String... decisions) {
        StringBuilder xml = new StringBuilder();
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<definitions xmlns=\"https://www.omg.org/spec/DMN/20191111/MODEL/\" id=\"defs_").append(definitionsName)
            .append("\" name=\"").append(definitionsName).append("\" namespace=\"http://test/").append(definitionsName).append("\">\n");
        for (In in : inputData) {
            xml.append("  <inputData id=\"in_").append(in.name()).append("\" name=\"").append(in.name()).append("\"><variable id=\"in_")
                .append(in.name()).append("_var\" name=\"").append(in.name()).append("\" typeRef=\"").append(in.type()).append("\" /></inputData>\n");
        }
        for (String decision : decisions) {
            xml.append(decision);
        }
        xml.append("</definitions>\n");
        return xml.toString();
    }

    /**
     * A one-decision document with a decision table.
     *
     * @param decisionId  decision id
     * @param hitPolicy   hit policy text
     * @param aggregation aggregation or {@code null}
     * @param inputs      input columns
     * @param outputs     output columns
     * @param rules       rules
     * @return the DMN XML
     */
    public static String singleTable(String decisionId, String hitPolicy, String aggregation, List<In> inputs, List<Out> outputs,
                                     List<Rule> rules) {
        List<String> names = new ArrayList<>(inputs.stream().map(In::name).toList());
        String type = outputs.size() == 1 && aggregation == null && List.of("UNIQUE", "FIRST", "ANY", "PRIORITY").contains(hitPolicy)
            ? outputs.get(0).type() : (aggregation != null ? outputs.get(0).type() : null);
        return document(decisionId, inputs, decisionXml(decisionId, type, List.of(), names,
            tableXml(decisionId, hitPolicy, aggregation, inputs, outputs, rules)));
    }

    /**
     * A one-decision document with a literal expression.
     *
     * @param decisionId decision id
     * @param inputs     input data
     * @param type       result type
     * @param expression the FEEL expression
     * @return the DMN XML
     */
    public static String literal(String decisionId, List<In> inputs, String type, String expression) {
        return document(decisionId, inputs, decisionXml(decisionId, type, List.of(), inputs.stream().map(In::name).toList(),
            "    <literalExpression id=\"" + decisionId + "_le\" typeRef=\"" + type + "\"><text>" + esc(expression) + "</text></literalExpression>\n"));
    }
}
