package io.github.kleash.activiti.dmn;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.operaton.bpm.dmn.engine.DmnDecision;
import org.operaton.bpm.dmn.engine.DmnDecisionResult;
import org.operaton.bpm.dmn.engine.DmnEngine;
import org.operaton.bpm.dmn.engine.DmnEngineConfiguration;
import org.operaton.bpm.dmn.engine.impl.DefaultDmnEngineConfiguration;
import org.operaton.bpm.dmn.engine.delegate.DmnDecisionEvaluationEvent;
import org.operaton.bpm.dmn.engine.delegate.DmnDecisionLiteralExpressionEvaluationEvent;
import org.operaton.bpm.dmn.engine.delegate.DmnDecisionLogicEvaluationEvent;
import org.operaton.bpm.dmn.engine.delegate.DmnDecisionTableEvaluationEvent;
import org.operaton.bpm.dmn.engine.delegate.DmnEvaluatedDecisionRule;
import org.operaton.bpm.dmn.engine.delegate.DmnEvaluatedOutput;
import org.operaton.bpm.engine.variable.Variables;

/**
 * {@link DmnEvaluator} backed by Operaton DMN (the maintained fork of the Camunda 7 DMN engine, Apache-2.0).
 *
 * <p>What Operaton does natively: DMN 1.1 to 1.3 documents, UNIQUE, FIRST, ANY, RULE ORDER and COLLECT with and
 * without SUM, MIN, MAX and COUNT, literal expressions, FEEL (feel-scala). What this class adds:
 * <ul>
 *   <li><b>PRIORITY and OUTPUT ORDER.</b> Operaton rejects both at parse time. The table is parsed with the hit
 *       policy rewritten to RULE ORDER and the matched rules are then ordered by the output's {@code outputValues}
 *       (see {@link PriorityOrdering}).</li>
 *   <li><b>DRD chaining.</b> Each decision is parsed on its own and the decisions of a requirement graph are
 *       evaluated bottom-up by this class, because a PRIORITY / OUTPUT ORDER decision must hand its <em>ordered</em>
 *       result to the decisions that require it. The result of a required decision is visible to the decisions that
 *       require it under its output column names and under its decision variable name (see {@link #publish}).</li>
 *   <li><b>Matched rules</b> from an Operaton evaluation listener.</li>
 *   <li><b>A clear error</b> instead of a silent wrong answer for constructs Operaton cannot execute (business
 *       knowledge models, contexts, invocations, decision services): use the KIE engine for those.</li>
 * </ul>
 */
public final class OperatonDmnEvaluator implements DmnEvaluator {

    /** Engine name accepted by {@code activiti.dmn.engine}. */
    public static final String NAME = "operaton";

    private final DmnEngine engine;
    private final ThreadLocal<List<DmnDecisionEvaluationEvent>> events = new ThreadLocal<>();
    private final LruCache<String, Prepared> cache;

    /**
     * Creates an evaluator with a cache of parsed documents.
     *
     * @param maxCachedDocuments how many parsed documents to keep
     */
    public OperatonDmnEvaluator(int maxCachedDocuments) {
        DmnEngineConfiguration configuration = DmnEngineConfiguration.createDefaultDmnEngineConfiguration();
        configuration.setCustomPostDecisionEvaluationListeners(List.of(event -> {
            List<DmnDecisionEvaluationEvent> sink = events.get();
            if (sink != null) {
                sink.add(event);
            }
        }));
        if (configuration instanceof DefaultDmnEngineConfiguration defaults) {
            defaults.getTransformer().dataTypeTransformerRegistry(new FeelTypeRegistry());
        }
        this.engine = configuration.buildEngine();
        this.cache = new LruCache<>(maxCachedDocuments);
    }

    /** Creates an evaluator that caches up to 256 parsed documents. */
    public OperatonDmnEvaluator() {
        this(256);
    }

    @Override
    public String engineName() {
        return NAME;
    }

    /** @return the number of parsed documents currently cached (for diagnostics and tests) */
    public int cachedDocuments() {
        return cache.size();
    }

    @Override
    public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
        Prepared prepared = cache.get(dmn.contentHash(), hash -> new Prepared(DmnModel.parse(dmn.xml())));
        DmnModel model = prepared.model;
        DmnModel.DecisionInfo requested = model.select(decisionRef);
        List<DmnModel.DecisionInfo> order = model.evaluationOrder(requested.id());
        for (DmnModel.DecisionInfo decision : order) {
            checkExecutable(dmn, decision);
        }

        Map<String, Object> variables = new LinkedHashMap<>();
        inputs.forEach((name, value) -> variables.put(name, DmnValues.toEngineInput(value)));

        List<DecisionEvaluation> results = new ArrayList<>();
        for (DmnModel.DecisionInfo decision : order) {
            DecisionEvaluation result = evaluateOne(dmn, prepared, decision, variables);
            results.add(result);
            publish(decision, result, variables);
        }
        return new DmnEvaluation(results.get(results.size() - 1), results);
    }

    @Override
    public void validate(DmnResource dmn) {
        Prepared prepared = cache.get(dmn.contentHash(), hash -> new Prepared(DmnModel.parse(dmn.xml())));
        for (DmnModel.DecisionInfo decision : prepared.model.decisions()) {
            checkExecutable(dmn, decision);
            prepared.decisions.computeIfAbsent(decision.id(), id -> prepareDecision(dmn, decision));
        }
    }

    private void checkExecutable(DmnResource dmn, DmnModel.DecisionInfo decision) {
        String where = "Decision '" + decision.id() + "' in " + dmn.name();
        if (decision.requiresKnowledge()) {
            throw new DmnModelException(where + " requires a business knowledge model or decision service, which the "
                + "Operaton engine cannot execute. Set activiti.dmn.engine=kie and add activiti-dmn-connector-kie.");
        }
        switch (decision.kind()) {
            case DECISION_TABLE, LITERAL_EXPRESSION -> { }
            case OTHER_BOXED_EXPRESSION -> throw new DmnModelException(where + " uses the boxed expression '"
                + decision.expressionElement() + "', which the Operaton engine cannot execute (it supports decision "
                + "tables and literal expressions). Set activiti.dmn.engine=kie and add activiti-dmn-connector-kie.");
            case NONE -> throw new DmnModelException(where + " has no decision logic");
        }
        if (decision.isTable()) {
            for (DmnModel.OutputInfo output : decision.outputs()) {
                if (output.name().isBlank()) {
                    throw new DmnModelException(where + ": output column '" + output.id()
                        + "' has no name; every output column of a decision table needs a name");
                }
            }
            if (decision.outputs().isEmpty()) {
                throw new DmnModelException(where + " has no output column");
            }
        }
    }

    private DecisionEvaluation evaluateOne(DmnResource dmn, Prepared prepared, DmnModel.DecisionInfo info,
                                           Map<String, Object> variables) {
        PreparedDecision decision = prepared.decisions.computeIfAbsent(info.id(), id -> prepareDecision(dmn, info));
        List<DmnDecisionEvaluationEvent> captured = new ArrayList<>();
        events.set(captured);
        DmnDecisionResult result;
        try {
            result = engine.evaluateDecision(decision.decision, Variables.fromMap(variables));
        } catch (RuntimeException e) {
            throw new DmnException("Evaluating decision '" + info.id() + "' of " + dmn.name() + " failed: " + e.getMessage(), e);
        } finally {
            events.remove();
        }
        DmnDecisionLogicEvaluationEvent logic = captured.isEmpty() ? null : captured.get(0).getDecisionResult();
        if (info.isTable()) {
            return tableResult(info, decision, result, logic);
        }
        return literalResult(info, result, logic);
    }

    private PreparedDecision prepareDecision(DmnResource dmn, DmnModel.DecisionInfo info) {
        String isolated = DmnDocuments.isolateDecision(dmn.xml(), info.id());
        DmnDecision decision;
        try {
            decision = engine.parseDecision(info.id(), new ByteArrayInputStream(isolated.getBytes(StandardCharsets.UTF_8)));
        } catch (RuntimeException e) {
            throw new DmnModelException("Operaton cannot parse decision '" + info.id() + "' of " + dmn.name() + ": " + e.getMessage(), e);
        }
        PriorityOrdering ordering = info.isTable() && info.hitPolicy().ordersByOutputValues() ? PriorityOrdering.of(info) : null;
        return new PreparedDecision(decision, ordering);
    }

    private DecisionEvaluation tableResult(DmnModel.DecisionInfo info, PreparedDecision prepared, DmnDecisionResult result,
                                           DmnDecisionLogicEvaluationEvent logic) {
        if (!(logic instanceof DmnDecisionTableEvaluationEvent table)) {
            throw new DmnException("Operaton reported no decision table evaluation for decision '" + info.id() + "'");
        }
        List<DmnEvaluatedDecisionRule> matching = table.getMatchingRules();
        List<Map<String, Object>> rows = new ArrayList<>();
        List<String> matchedRules = new ArrayList<>();

        if (info.hitPolicy().ordersByOutputValues()) {
            record Hit(String ruleId, Map<String, Object> row) { }
            List<Hit> hits = new ArrayList<>();
            for (DmnEvaluatedDecisionRule rule : matching) {
                hits.add(new Hit(rule.getId(), rowOf(rule)));
            }
            List<Hit> ordered = prepared.ordering.sort(hits, Hit::row);
            if (info.hitPolicy() == DmnHitPolicy.PRIORITY && !ordered.isEmpty()) {
                ordered = ordered.subList(0, 1);
            }
            for (Hit hit : ordered) {
                rows.add(hit.row());
                matchedRules.add(hit.ruleId());
            }
        } else if (info.aggregation() != DmnAggregation.NONE) {
            // Operaton reports the aggregate under a null name when no rule matched (COUNT gives 0): rebuild the row.
            // COUNT is defined by DMN 1.3 as the number of DISTINCT output values, which is what KIE implements;
            // Operaton counts the matched rules, so it is recomputed here to get the same answer on both engines.
            Object aggregate = result.isEmpty() ? null : result.getSingleResult().getFirstEntry();
            if (info.aggregation() == DmnAggregation.COUNT) {
                Set<Object> distinct = new HashSet<>();
                for (DmnEvaluatedDecisionRule rule : matching) {
                    Object value = rowOf(rule).get(info.outputs().get(0).name());
                    if (value != null) {
                        distinct.add(value);
                    }
                }
                aggregate = (long) distinct.size();
            }
            if (!matching.isEmpty() || info.aggregation() == DmnAggregation.COUNT) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put(info.outputs().get(0).name(), DmnValues.normalizeResult(aggregate));
                if (row.values().iterator().next() != null) {
                    rows.add(row);
                }
            }
            for (DmnEvaluatedDecisionRule rule : matching) {
                matchedRules.add(rule.getId());
            }
        } else {
            for (Map<String, Object> row : result.getResultList()) {
                rows.add(normalizeRow(row));
            }
            for (DmnEvaluatedDecisionRule rule : matching) {
                matchedRules.add(rule.getId());
            }
        }
        return new DecisionEvaluation(info.id(), info.name(), info.kind(), info.hitPolicy(), info.aggregation(),
            info.isMultiResult(), info.resultName(), rows, matchedRules);
    }

    private DecisionEvaluation literalResult(DmnModel.DecisionInfo info, DmnDecisionResult result,
                                             DmnDecisionLogicEvaluationEvent logic) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (logic instanceof DmnDecisionLiteralExpressionEvaluationEvent literal) {
            Object value = literal.getOutputValue() == null ? null : DmnValues.normalizeResult(literal.getOutputValue().getValue());
            if (value != null) {
                rows.add(Map.of(info.resultName(), value));
            }
        } else {
            for (Map<String, Object> row : result.getResultList()) {
                rows.add(normalizeRow(row));
            }
        }
        return new DecisionEvaluation(info.id(), info.name(), info.kind(), null, DmnAggregation.NONE, false,
            info.resultName(), rows, List.of());
    }

    private static Map<String, Object> rowOf(DmnEvaluatedDecisionRule rule) {
        Map<String, Object> row = new LinkedHashMap<>();
        for (DmnEvaluatedOutput output : rule.getOutputEntries().values()) {
            row.put(output.getOutputName(), DmnValues.normalizeResult(output.getValue() == null ? null : output.getValue().getValue()));
        }
        return row;
    }

    private static Map<String, Object> normalizeRow(Map<String, Object> row) {
        Map<String, Object> normalized = new LinkedHashMap<>();
        row.forEach((name, value) -> normalized.put(name, DmnValues.normalizeResult(value)));
        return normalized;
    }

    /**
     * Makes the result of a decision visible to the decisions that require it. A single-result decision exposes its
     * value (or {@code null} when nothing matched); a multi-result decision exposes the list of values. This is done
     * under every output column name (Operaton's convention) and, when it differs, under the decision's variable name
     * (the DMN convention that KIE follows): the plain value for a single-output table, otherwise the row map (or the
     * list of row maps).
     */
    private static void publish(DmnModel.DecisionInfo info, DecisionEvaluation result, Map<String, Object> variables) {
        if (!info.isTable()) {
            Object value = result.rows().isEmpty() ? null : result.rows().get(0).get(info.resultName());
            variables.put(info.resultName(), value);
            return;
        }
        List<String> names = info.outputs().stream().map(DmnModel.OutputInfo::name).toList();
        for (String name : names) {
            if (info.isMultiResult()) {
                variables.put(name, result.rows().stream().map(row -> row.get(name)).toList());
            } else {
                variables.put(name, result.rows().isEmpty() ? null : result.rows().get(0).get(name));
            }
        }
        if (!names.contains(info.resultName())) {
            if (info.isMultiResult()) {
                variables.put(info.resultName(), names.size() == 1
                    ? result.rows().stream().map(row -> row.get(names.get(0))).toList() : result.rows());
            } else if (result.rows().isEmpty()) {
                variables.put(info.resultName(), null);
            } else {
                variables.put(info.resultName(), names.size() == 1 ? result.rows().get(0).get(names.get(0)) : result.rows().get(0));
            }
        }
    }

    private record PreparedDecision(DmnDecision decision, PriorityOrdering ordering) { }

    private static final class Prepared {
        final DmnModel model;
        final Map<String, PreparedDecision> decisions = new ConcurrentHashMap<>();

        Prepared(DmnModel model) {
            this.model = model;
        }
    }
}
