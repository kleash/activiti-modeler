package io.github.kleash.activiti.rest.core.service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.activiti.engine.RepositoryService;

import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.DmnModel;
import io.github.kleash.activiti.rest.core.dto.DefinitionDtos;
import io.github.kleash.activiti.rest.core.dto.EngineDtos;

/** {@link DecisionCatalog} over the DMN connector: parses the {@code .dmn} resources of a deployment with {@link DmnModel}. */
public class DmnDecisionCatalog implements DecisionCatalog {

    private final RepositoryService repository;
    private final DmnEvaluator evaluator;

    public DmnDecisionCatalog(RepositoryService repository, DmnEvaluator evaluator) {
        this.repository = repository;
        this.evaluator = evaluator;
    }

    @Override
    public EngineDtos.EngineDmn engine() {
        return new EngineDtos.EngineDmn(true, evaluator.engineName());
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public List<DefinitionDtos.DecisionResource> decisionsOf(String deploymentId) {
        List<DefinitionDtos.DecisionResource> resources = new ArrayList<>();
        for (String name : repository.getDeploymentResourceNames(deploymentId).stream().filter(n -> n.endsWith(".dmn")).sorted().toList()) {
            String xml;
            try (InputStream in = repository.getResourceAsStream(deploymentId, name)) {
                xml = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new IllegalStateException("Cannot read " + name + " of deployment " + deploymentId, e);
            }
            try {
                DmnModel model = DmnModel.parse(xml);
                resources.add(new DefinitionDtos.DecisionResource(name, model.definitionsName(),
                        model.decisions().stream().map(DmnDecisionCatalog::decision).toList(), null));
            } catch (RuntimeException e) {
                resources.add(new DefinitionDtos.DecisionResource(name, null, List.of(), e.getMessage()));
            }
        }
        return resources;
    }

    private static DefinitionDtos.DecisionInfo decision(DmnModel.DecisionInfo d) {
        return new DefinitionDtos.DecisionInfo(d.id(), d.name(), d.kind().name(), d.hitPolicy() == null ? null : d.hitPolicy().name(),
                d.aggregation() == null ? null : d.aggregation().name(), d.inputCount(),
                d.outputs().stream().map(DmnModel.OutputInfo::name).toList(), d.ruleIds(), d.requiredDecisionIds());
    }
}
