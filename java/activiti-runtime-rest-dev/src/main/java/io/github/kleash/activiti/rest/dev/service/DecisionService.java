package io.github.kleash.activiti.rest.dev.service;

import java.util.List;
import java.util.Map;

import io.github.kleash.activiti.dmn.DecisionEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluationService;
import io.github.kleash.activiti.rest.dev.dto.DevDtos;

/** Evaluates a decision of an uploaded DMN document or of a deployment. */
public class DecisionService {

    private final DmnEvaluationService dmn;

    public DecisionService(DmnEvaluationService dmn) {
        this.dmn = dmn;
    }

    public DevDtos.DecisionOutcome evaluate(DevDtos.DecisionRequest request) {
        boolean hasDmn = request.dmn() != null && !request.dmn().isBlank();
        boolean hasDeployment = request.deploymentId() != null && !request.deploymentId().isBlank();
        if (hasDmn == hasDeployment) {
            throw new IllegalArgumentException("Give exactly one of dmn (the document) and deploymentId");
        }
        Map<String, Object> inputs = request.inputs() == null ? Map.of() : request.inputs();
        DmnEvaluation evaluation = hasDmn
                ? dmn.evaluateXml(request.dmn(), request.decisionRef(), inputs)
                : dmn.evaluateInDeployment(request.deploymentId(), request.decisionRef(), inputs);
        List<DevDtos.DecisionStep> steps = evaluation.decisions().stream().map(DecisionService::step).toList();
        return new DevDtos.DecisionOutcome(evaluation.decisionId(), evaluation.matched(), evaluation.rows(), evaluation.matchedRules(),
                dmn.evaluator().engineName(), steps);
    }

    private static DevDtos.DecisionStep step(DecisionEvaluation d) {
        return new DevDtos.DecisionStep(d.decisionId(), d.decisionName(), d.kind().name(), d.hitPolicy() == null ? null : d.hitPolicy().name(),
                d.aggregation() == null ? null : d.aggregation().name(), d.multiResult(), d.rows(), d.matchedRules());
    }
}
