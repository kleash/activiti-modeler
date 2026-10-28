package io.github.kleash.activiti.dmn.kie;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.kie.api.io.Resource;
import org.kie.dmn.api.core.DMNContext;
import org.kie.dmn.api.core.DMNDecisionResult;
import org.kie.dmn.api.core.DMNMessage;
import org.kie.dmn.api.core.DMNModel;
import org.kie.dmn.api.core.DMNResult;
import org.kie.dmn.api.core.DMNRuntime;
import org.kie.dmn.api.core.event.AfterEvaluateDecisionTableEvent;
import org.kie.dmn.api.core.event.DMNRuntimeEventListener;
import org.kie.dmn.core.internal.utils.DMNRuntimeBuilder;
import org.kie.internal.io.ResourceFactory;

import io.github.kleash.activiti.dmn.DecisionEvaluation;
import io.github.kleash.activiti.dmn.DmnAggregation;
import io.github.kleash.activiti.dmn.DmnDocuments;
import io.github.kleash.activiti.dmn.DmnHitPolicy;
import io.github.kleash.activiti.dmn.PriorityOrdering;
import io.github.kleash.activiti.dmn.DmnEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.DmnException;
import io.github.kleash.activiti.dmn.DmnModel;
import io.github.kleash.activiti.dmn.DmnModelException;
import io.github.kleash.activiti.dmn.DmnResource;
import io.github.kleash.activiti.dmn.DmnValues;
import io.github.kleash.activiti.dmn.LruCache;

/**
 * {@link DmnEvaluator} backed by the Apache KIE DMN engine ({@code kie-dmn-core}).
 *
 * <p>KIE implements all of DMN 1.3: all seven hit policies natively, business knowledge models, boxed expressions
 * (context, invocation, relation, function definition), decision services. It is strict about the model
 * (see docs/user-guide/dmn-conventions.md) and heavier than Operaton. Compile errors are reported as
 * {@link DmnModelException}, evaluation errors as {@link DmnException}.
 *
 * <p>Matched rules are the <em>selected</em> rules of KIE's {@code AfterEvaluateDecisionTableEvent}, which follow the
 * same definition as {@link DecisionEvaluation}. Numbers (KIE uses {@code BigDecimal}) are normalised by
 * {@link DmnValues#normalizeResult}.
 */
public final class KieDmnEvaluator implements DmnEvaluator {

    /** Engine name accepted by {@code activiti.dmn.engine}. */
    public static final String NAME = "kie";

    private final ThreadLocal<Map<String, TableEvent>> tableEvents = new ThreadLocal<>();
    private final LruCache<String, Prepared> cache;

    /**
     * Creates an evaluator.
     *
     * @param maxCachedDocuments how many compiled documents to keep
     */
    public KieDmnEvaluator(int maxCachedDocuments) {
        this.cache = new LruCache<>(maxCachedDocuments);
    }

    /** Creates an evaluator that keeps up to 256 compiled documents. */
    public KieDmnEvaluator() {
        this(256);
    }

    @Override
    public String engineName() {
        return NAME;
    }

    @Override
    public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
        Prepared prepared = cache.get(dmn.contentHash(), hash -> compile(dmn, dmn.xml()));
        DmnModel.DecisionInfo requested = prepared.info.select(decisionRef);
        List<DmnModel.DecisionInfo> order = prepared.info.evaluationOrder(requested.id());

        Map<String, TableEvent> events = new LinkedHashMap<>();
        DMNResult result = run(dmn, prepared, requested.id(), inputs, events);

        List<DecisionEvaluation> evaluations = new ArrayList<>();
        for (DmnModel.DecisionInfo info : order) {
            DMNDecisionResult decisionResult = result.getDecisionResultById(info.id());
            if (decisionResult == null) {
                throw new DmnException("KIE did not evaluate decision '" + info.id() + "' of " + dmn.name());
            }
            Object value = DmnValues.normalizeResult(decisionResult.getResult());
            evaluations.add(toEvaluation(info, value, matchedRules(dmn, prepared, info, events.get(info.name()), inputs)));
        }
        return new DmnEvaluation(evaluations.get(evaluations.size() - 1), evaluations);
    }

    private DMNResult run(DmnResource dmn, Prepared prepared, String decisionId, Map<String, Object> inputs,
                          Map<String, TableEvent> events) {
        DMNContext context = prepared.runtime.newContext();
        inputs.forEach((name, value) -> context.set(name, DmnValues.toEngineInput(value)));
        tableEvents.set(events);
        DMNResult result;
        try {
            result = prepared.runtime.evaluateById(prepared.model, context, decisionId);
        } catch (RuntimeException e) {
            throw new DmnException("KIE failed to evaluate decision '" + decisionId + "' of " + dmn.name() + ": " + e.getMessage(), e);
        } finally {
            tableEvents.remove();
        }
        if (result.hasErrors()) {
            throw new DmnException("KIE reported errors evaluating decision '" + decisionId + "' of " + dmn.name() + ": "
                + messages(result.getMessages(DMNMessage.Severity.ERROR)));
        }
        return result;
    }

    /**
     * The rules behind the result, following the definition in {@link DecisionEvaluation}. KIE's own "selected" rules
     * are only used for PRIORITY: for OUTPUT ORDER it reports just the first rule and for COLLECT MIN / MAX one rule
     * with a mangled id, so the matched rules are taken from KIE's {@code matches}.
     */
    private List<String> matchedRules(DmnResource dmn, Prepared prepared, DmnModel.DecisionInfo info, TableEvent event,
                                      Map<String, Object> inputs) {
        if (!info.isTable() || event == null) {
            return List.of();
        }
        List<String> ruleIds = info.ruleIds();
        List<String> matches = event.matches().stream().map(i -> ruleIds.get(i - 1)).toList();
        switch (info.hitPolicy()) {
            case FIRST, ANY:
                return matches.isEmpty() ? matches : matches.subList(0, 1);
            case PRIORITY:
                return event.selected().stream().map(i -> ruleIds.get(i - 1)).toList();
            case OUTPUT_ORDER:
                return outputOrder(dmn, prepared, info, inputs);
            default:
                return matches;
        }
    }

    /** Orders the matched rules of an OUTPUT ORDER table by priority using a RULE ORDER copy of the table. */
    private List<String> outputOrder(DmnResource dmn, Prepared prepared, DmnModel.DecisionInfo info, Map<String, Object> inputs) {
        Prepared variant = prepared.ruleOrderVariants.computeIfAbsent(info.id(),
            id -> compile(dmn, DmnDocuments.withHitPolicy(dmn.xml(), id, DmnHitPolicy.RULE_ORDER)));
        Map<String, TableEvent> events = new LinkedHashMap<>();
        DMNResult result = run(dmn, variant, info.id(), inputs, events);
        TableEvent event = events.get(info.name());
        Object value = DmnValues.normalizeResult(result.getDecisionResultById(info.id()).getResult());
        if (event == null || !(value instanceof List<?> rows) || rows.size() != event.matches().size()) {
            return List.of();
        }
        List<String> outputs = info.outputs().stream().map(DmnModel.OutputInfo::name).toList();
        record Hit(String ruleId, Map<String, Object> row) { }
        List<Hit> hits = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            hits.add(new Hit(info.ruleIds().get(event.matches().get(i) - 1), row(outputs, rows.get(i))));
        }
        return PriorityOrdering.of(info).sort(hits, Hit::row).stream().map(Hit::ruleId).toList();
    }

    private Prepared compile(DmnResource dmn, String xml) {
        DmnModel info = DmnModel.parse(dmn.xml());
        Resource resource = ResourceFactory.newByteArrayResource(xml.getBytes(StandardCharsets.UTF_8));
        resource.setSourcePath(dmn.name().endsWith(".dmn") ? dmn.name() : dmn.name() + ".dmn");
        DMNRuntime runtime = DMNRuntimeBuilder.fromDefaults().buildConfiguration().fromResources(List.of(resource))
            .getOrElseThrow(cause -> new DmnModelException("KIE cannot compile " + dmn.name() + ": " + cause.getMessage(), cause));
        if (runtime.getModels().isEmpty()) {
            throw new DmnModelException("KIE found no DMN model in " + dmn.name());
        }
        DMNModel model = runtime.getModels().get(0);
        if (model.hasErrors()) {
            throw new DmnModelException("KIE reports errors in " + dmn.name() + ": " + messages(model.getMessages(DMNMessage.Severity.ERROR)));
        }
        runtime.addListener(new DMNRuntimeEventListener() {
            @Override
            public void afterEvaluateDecisionTable(AfterEvaluateDecisionTableEvent event) {
                Map<String, TableEvent> sink = tableEvents.get();
                if (sink != null) {
                    sink.put(event.getDecisionName(), new TableEvent(List.copyOf(event.getMatches()), List.copyOf(event.getSelected())));
                }
            }
        });
        return new Prepared(runtime, model, info);
    }

    private DecisionEvaluation toEvaluation(DmnModel.DecisionInfo info, Object result, List<String> matchedRules) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (!info.isTable()) {
            if (result != null) {
                rows.add(Map.of(info.resultName(), result));
            }
            return new DecisionEvaluation(info.id(), info.name(), info.kind(), null, DmnAggregation.NONE, false,
                info.resultName(), rows, List.of());
        }
        List<String> outputs = info.outputs().stream().map(DmnModel.OutputInfo::name).toList();
        if (info.isMultiResult()) {
            if (result instanceof List<?> list) {
                for (Object element : list) {
                    rows.add(row(outputs, element));
                }
            } else if (result != null) {
                throw new DmnException("Decision '" + info.id() + "' should return a list but KIE returned " + result);
            }
        } else if (result != null) {
            rows.add(row(outputs, result));
        }
        return new DecisionEvaluation(info.id(), info.name(), info.kind(), info.hitPolicy(), info.aggregation(),
            info.isMultiResult(), info.resultName(), rows, matchedRules);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> row(List<String> outputs, Object value) {
        Map<String, Object> row = new LinkedHashMap<>();
        if (outputs.size() == 1) {
            row.put(outputs.get(0), value);
        } else if (value instanceof Map<?, ?> map) {
            for (String output : outputs) {
                row.put(output, ((Map<String, Object>) map).get(output));
            }
        } else {
            throw new DmnException("A decision table with outputs " + outputs + " returned a non-context value: " + value);
        }
        return row;
    }

    private static String messages(List<DMNMessage> messages) {
        return messages.stream().map(m -> m.getMessage()).toList().toString();
    }

    private record TableEvent(List<Integer> matches, List<Integer> selected) { }

    private static final class Prepared {
        final DMNRuntime runtime;
        final DMNModel model;
        final DmnModel info;
        final Map<String, Prepared> ruleOrderVariants = new java.util.concurrent.ConcurrentHashMap<>();

        Prepared(DMNRuntime runtime, DMNModel model, DmnModel info) {
            this.runtime = runtime;
            this.model = model;
            this.info = info;
        }
    }
}
