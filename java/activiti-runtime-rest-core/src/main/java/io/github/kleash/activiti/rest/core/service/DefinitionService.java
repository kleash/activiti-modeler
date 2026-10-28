package io.github.kleash.activiti.rest.core.service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.activiti.engine.ActivitiObjectNotFoundException;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.repository.Deployment;
import org.activiti.engine.repository.DeploymentQuery;
import org.activiti.engine.repository.ProcessDefinition;
import org.activiti.engine.repository.ProcessDefinitionQuery;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.rest.core.dto.DefinitionDtos;
import io.github.kleash.activiti.rest.core.dto.PageDto;

/** Deployments, process definitions, and the BPMN, extensions and DMN that belong to them. */
public class DefinitionService {

    private final RepositoryService repository;
    private final RuntimeService runtime;
    private final ObjectMapper mapper;
    private final DecisionCatalog decisions;

    public DefinitionService(RepositoryService repository, RuntimeService runtime, ObjectMapper mapper, DecisionCatalog decisions) {
        this.repository = repository;
        this.runtime = runtime;
        this.mapper = mapper;
        this.decisions = decisions;
    }

    // ---- deployments ----------------------------------------------------------------------------------------------------

    /** Deployments, newest first. */
    public PageDto<DefinitionDtos.Deployment> deployments(Paging paging, String nameLike) {
        DeploymentQuery query = repository.createDeploymentQuery();
        if (nameLike != null && !nameLike.isBlank()) {
            query.deploymentNameLike("%" + nameLike + "%");
        }
        query.orderByDeploymenTime().desc();
        List<DefinitionDtos.Deployment> items = query.listPage(paging.first(), paging.size()).stream().map(DefinitionService::deployment).toList();
        return new PageDto<>(items, paging.page(), paging.size(), query.count());
    }

    /** One deployment. */
    public DefinitionDtos.Deployment deployment(String id) {
        return deployment(requireDeployment(id));
    }

    /** The resources of a deployment. */
    public List<DefinitionDtos.DeploymentResource> resources(String deploymentId) {
        requireDeployment(deploymentId);
        return repository.getDeploymentResourceNames(deploymentId).stream().sorted()
                .map(name -> new DefinitionDtos.DeploymentResource(name, kindOf(name))).toList();
    }

    /** The content of one resource of a deployment. */
    public byte[] resourceContent(String deploymentId, String name) {
        requireDeployment(deploymentId);
        if (!repository.getDeploymentResourceNames(deploymentId).contains(name)) {
            throw new ActivitiObjectNotFoundException("Deployment " + deploymentId + " has no resource '" + name + "'", Deployment.class);
        }
        try (InputStream in = repository.getResourceAsStream(deploymentId, name)) {
            return in.readAllBytes();
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read resource '" + name + "' of deployment " + deploymentId, e);
        }
    }

    // ---- process definitions ----------------------------------------------------------------------------------------------

    /**
     * Process definitions, by key and version.
     *
     * @param latest        only the latest version of each key
     * @param includeCounts add the number of running instances to each definition
     */
    public PageDto<DefinitionDtos.ProcessDefinition> definitions(Paging paging, String key, String nameLike, boolean latest, String deploymentId,
                                                                 Boolean suspended, boolean includeCounts) {
        ProcessDefinitionQuery query = repository.createProcessDefinitionQuery();
        if (key != null && !key.isBlank()) {
            query.processDefinitionKey(key);
        }
        if (nameLike != null && !nameLike.isBlank()) {
            query.processDefinitionNameLike("%" + nameLike + "%");
        }
        if (deploymentId != null && !deploymentId.isBlank()) {
            query.deploymentId(deploymentId);
        }
        if (latest) {
            query.latestVersion();
        }
        if (Boolean.TRUE.equals(suspended)) {
            query.suspended();
        } else if (Boolean.FALSE.equals(suspended)) {
            query.active();
        }
        query.orderByProcessDefinitionKey().asc().orderByProcessDefinitionVersion().desc();
        List<DefinitionDtos.ProcessDefinition> items = new ArrayList<>();
        for (ProcessDefinition definition : query.listPage(paging.first(), paging.size())) {
            items.add(definition(definition, includeCounts));
        }
        return new PageDto<>(items, paging.page(), paging.size(), query.count());
    }

    /** One definition, by id or, failing that, the latest version of that key. */
    public DefinitionDtos.ProcessDefinition definition(String idOrKey, boolean includeCounts) {
        return definition(require(idOrKey), includeCounts);
    }

    /** The BPMN XML of a definition. */
    public String xml(String idOrKey) {
        ProcessDefinition definition = require(idOrKey);
        try (InputStream in = repository.getResourceAsStream(definition.getDeploymentId(), definition.getResourceName())) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + definition.getResourceName(), e);
        }
    }

    /** The entry of the definition in the {@code *-extensions.json} of its deployment. */
    public DefinitionDtos.DefinitionExtensions extensions(String idOrKey) {
        ProcessDefinition definition = require(idOrKey);
        for (String name : repository.getDeploymentResourceNames(definition.getDeploymentId()).stream().sorted().toList()) {
            if (!name.endsWith("-extensions.json")) {
                continue;
            }
            try (InputStream in = repository.getResourceAsStream(definition.getDeploymentId(), name)) {
                JsonNode root = mapper.readTree(in);
                JsonNode entry = root == null ? null : root.path("extensions").get(definition.getKey());
                if (entry != null) {
                    return new DefinitionDtos.DefinitionExtensions(name, entry);
                }
            } catch (IOException e) {
                throw new IllegalStateException("The extensions file " + name + " of deployment " + definition.getDeploymentId() + " is not valid JSON: "
                        + e.getMessage(), e);
            }
        }
        throw new ActivitiObjectNotFoundException("Process definition " + definition.getId() + " ('" + definition.getKey()
                + "') has no entry in a *-extensions.json of its deployment", ProcessDefinition.class);
    }

    /** The DMN decisions of the definition's deployment. */
    public DefinitionDtos.DefinitionDecisions decisions(String idOrKey) {
        ProcessDefinition definition = require(idOrKey);
        return new DefinitionDtos.DefinitionDecisions(decisions.available(), decisions.decisionsOf(definition.getDeploymentId()));
    }

    public void suspend(String idOrKey) {
        repository.suspendProcessDefinitionById(require(idOrKey).getId());
    }

    public void activate(String idOrKey) {
        repository.activateProcessDefinitionById(require(idOrKey).getId());
    }

    /** Resolves a definition id, or a key to its latest version. */
    public ProcessDefinition require(String idOrKey) {
        ProcessDefinition definition = repository.createProcessDefinitionQuery().processDefinitionId(idOrKey).singleResult();
        if (definition == null) {
            definition = repository.createProcessDefinitionQuery().processDefinitionKey(idOrKey).latestVersion().singleResult();
        }
        if (definition == null) {
            throw new ActivitiObjectNotFoundException("No process definition with id or key '" + idOrKey + "'", ProcessDefinition.class);
        }
        return definition;
    }

    private Deployment requireDeployment(String id) {
        Deployment deployment = repository.createDeploymentQuery().deploymentId(id).singleResult();
        if (deployment == null) {
            throw new ActivitiObjectNotFoundException("No deployment with id '" + id + "'", Deployment.class);
        }
        return deployment;
    }

    private DefinitionDtos.ProcessDefinition definition(ProcessDefinition d, boolean includeCounts) {
        Long running = includeCounts ? runtime.createProcessInstanceQuery().processDefinitionId(d.getId()).count() : null;
        return new DefinitionDtos.ProcessDefinition(d.getId(), d.getKey(), d.getName(), d.getDescription(), d.getVersion(), d.getDeploymentId(),
                d.getResourceName(), d.getDiagramResourceName(), d.getCategory(), d.isSuspended(), d.getTenantId(), d.hasStartFormKey(), running);
    }

    private static DefinitionDtos.Deployment deployment(Deployment d) {
        return new DefinitionDtos.Deployment(d.getId(), d.getName(), Values.instant(d.getDeploymentTime()), d.getCategory(), d.getKey(), d.getTenantId());
    }

    /** The kind of a resource name: bpmn, dmn, extensions, image or other. */
    public static String kindOfName(String name) {
        return kindOf(name);
    }

    static String kindOf(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".bpmn20.xml") || lower.endsWith(".bpmn")) {
            return "bpmn";
        }
        if (lower.endsWith(".dmn")) {
            return "dmn";
        }
        if (lower.endsWith("-extensions.json")) {
            return "extensions";
        }
        if (lower.endsWith(".png") || lower.endsWith(".svg") || lower.endsWith(".jpg") || lower.endsWith(".gif")) {
            return "image";
        }
        return "other";
    }

}
