package io.github.kleash.activiti.dmn;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Output priority for the hit policies PRIORITY and OUTPUT ORDER, which Operaton does not support natively.
 *
 * <h2>Semantics implemented (DMN 1.3, hit policies PRIORITY and OUTPUT ORDER)</h2>
 * <ul>
 *   <li>The priority of an output value is its position in the output column's {@code outputValues} list: the
 *       first value has the highest priority.</li>
 *   <li>With several output columns the ordering is lexicographic in <em>column order</em>: rules are compared by the
 *       priority of their first output value; ties are broken by the second column, and so on. A column without
 *       {@code outputValues} does not take part in the ordering. At least one column must define {@code outputValues}.</li>
 *   <li>Rules that are still tied keep rule order (the sort is stable).</li>
 *   <li>PRIORITY returns the first rule of that ordering, OUTPUT ORDER returns all matched rules in that ordering.</li>
 *   <li>A value that is missing from the column's {@code outputValues} is an error (the DMN spec constrains outputs
 *       to the allowed values). An empty output entry ({@code null}) has the lowest priority.</li>
 * </ul>
 *
 * <p>The {@code outputValues} text must be a comma separated list of FEEL literals: strings, numbers,
 * {@code true} or {@code false}, which is what dmn-js writes.
 */
public final class PriorityOrdering {

    /**
     * Priority list of one output column.
     *
     * @param outputName the output column name
     * @param values     the allowed values, highest priority first
     */
    public record Column(String outputName, List<Object> values) {
    }

    private final String decisionId;
    private final List<Column> columns;

    private PriorityOrdering(String decisionId, List<Column> columns) {
        this.decisionId = decisionId;
        this.columns = columns;
    }

    /**
     * Reads the priority lists of a decision table.
     *
     * @param decision a decision table whose hit policy is PRIORITY or OUTPUT ORDER
     * @return the ordering
     * @throws DmnModelException when no output column has {@code outputValues} or a list is not made of literals
     */
    public static PriorityOrdering of(DmnModel.DecisionInfo decision) {
        List<Column> columns = new ArrayList<>();
        for (DmnModel.OutputInfo output : decision.outputs()) {
            if (output.outputValuesText() != null && !output.outputValuesText().isBlank()) {
                columns.add(new Column(output.name(), parseValues(decision, output)));
            }
        }
        if (columns.isEmpty()) {
            throw new DmnModelException("Decision '" + decision.id() + "': hit policy "
                + decision.hitPolicy().xmlName() + " needs 'outputValues' (the priority list) on at least one output column");
        }
        return new PriorityOrdering(decision.id(), List.copyOf(columns));
    }

    /** @return the priority lists, in output column order */
    public List<Column> columns() {
        return columns;
    }

    /**
     * Sorts items stably by output priority.
     *
     * @param items the matched rules (any carrier type), in rule order
     * @param row   extracts the output row (column name to value) from an item
     * @param <T>   the item type
     * @return a new list in priority order
     * @throws DmnException when an output value is not in its column's {@code outputValues}
     */
    public <T> List<T> sort(List<T> items, Function<T, Map<String, Object>> row) {
        List<T> sorted = new ArrayList<>(items);
        Comparator<T> comparator = (a, b) -> {
            for (Column column : columns) {
                int byColumn = Integer.compare(rank(column, row.apply(a)), rank(column, row.apply(b)));
                if (byColumn != 0) {
                    return byColumn;
                }
            }
            return 0;
        };
        sorted.sort(comparator);
        return sorted;
    }

    private int rank(Column column, Map<String, Object> row) {
        Object value = DmnValues.normalizeResult(row.get(column.outputName()));
        if (value == null) {
            return column.values().size();
        }
        for (int i = 0; i < column.values().size(); i++) {
            if (sameValue(column.values().get(i), value)) {
                return i;
            }
        }
        throw new DmnException("Decision '" + decisionId + "': output '" + column.outputName() + "' produced "
            + describe(value) + ", which is not in the column's outputValues " + column.values().stream().map(PriorityOrdering::describe).toList());
    }

    private static boolean sameValue(Object listed, Object actual) {
        if (listed instanceof BigDecimal number && actual instanceof Number actualNumber) {
            return number.compareTo(new BigDecimal(actualNumber.toString())) == 0;
        }
        return listed.equals(actual);
    }

    private static String describe(Object value) {
        return value instanceof String text ? "\"" + text + "\"" : String.valueOf(value);
    }

    private static List<Object> parseValues(DmnModel.DecisionInfo decision, DmnModel.OutputInfo output) {
        String text = output.outputValuesText().trim();
        List<Object> values = new ArrayList<>();
        int i = 0;
        while (i < text.length()) {
            char c = text.charAt(i);
            if (Character.isWhitespace(c) || c == ',') {
                i++;
            } else if (c == '"') {
                StringBuilder literal = new StringBuilder();
                i++;
                boolean closed = false;
                while (i < text.length()) {
                    char d = text.charAt(i++);
                    if (d == '\\' && i < text.length()) {
                        literal.append(unescape(text.charAt(i++)));
                    } else if (d == '"') {
                        closed = true;
                        break;
                    } else {
                        literal.append(d);
                    }
                }
                if (!closed) {
                    throw unsupported(decision, output, text);
                }
                values.add(literal.toString());
            } else {
                int end = i;
                while (end < text.length() && text.charAt(end) != ',' && !Character.isWhitespace(text.charAt(end))) {
                    end++;
                }
                values.add(parseBare(decision, output, text, text.substring(i, end)));
                i = end;
            }
        }
        if (values.isEmpty()) {
            throw unsupported(decision, output, text);
        }
        return List.copyOf(values);
    }

    private static char unescape(char c) {
        return switch (c) {
            case 'n' -> '\n';
            case 't' -> '\t';
            case 'r' -> '\r';
            default -> c;
        };
    }

    private static Object parseBare(DmnModel.DecisionInfo decision, DmnModel.OutputInfo output, String whole, String token) {
        switch (token) {
            case "true":
                return Boolean.TRUE;
            case "false":
                return Boolean.FALSE;
            default:
                try {
                    return new BigDecimal(token);
                } catch (NumberFormatException e) {
                    throw unsupported(decision, output, whole);
                }
        }
    }

    private static DmnModelException unsupported(DmnModel.DecisionInfo decision, DmnModel.OutputInfo output, String text) {
        return new DmnModelException("Decision '" + decision.id() + "': the outputValues of output '" + output.name()
            + "' must be a comma separated list of string, number or boolean literals, found: " + text);
    }
}
