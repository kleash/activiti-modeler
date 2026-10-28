package io.github.kleash.activiti.dmn;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.activiti.engine.RepositoryService;

/**
 * Resolves the value of the {@code _activiti_dmn_table_} constant against the {@code .dmn} resources of one
 * deployment (ADR 0004). The resolution order is:
 * <ol>
 *   <li>the <b>resource base name</b>: the last path segment of the resource name without {@code .dmn}
 *       (Spring auto-deployment stores absolute paths, so only the last segment is compared). This is the Alfresco
 *       Process Automation convention; it selects that file's sink decision;</li>
 *   <li>the {@code definitions/@name} of a DMN file; it selects that file's sink decision;</li>
 *   <li>a <b>decision id</b> in any DMN file of the deployment (what the modeler writes).</li>
 * </ol>
 * A step that matches more than one candidate, or whose file has more than one sink decision, fails with a
 * {@link DmnResolutionException}; there is no fall-through to the next step. Parsed documents are cached per
 * deployment id and resource name (a deployment's resources never change).
 */
public class DmnDeploymentResolver {

    private static final String DMN_SUFFIX = ".dmn";

    /**
     * The outcome of a resolution.
     *
     * @param resource the DMN document that holds the decision
     * @param model    its parsed structure
     * @param decision the selected decision
     */
    public record Resolved(DmnResource resource, DmnModel model, DmnModel.DecisionInfo decision) {
    }

    private record Parsed(DmnResource resource, DmnModel model) {
    }

    private final RepositoryService repositoryService;
    private final LruCache<String, Parsed> documents;
    private final LruCache<String, List<String>> resourceNames;

    /**
     * Creates a resolver.
     *
     * @param repositoryService the engine's repository service
     * @param cacheSize         how many parsed documents (and deployments' resource lists) to cache
     */
    public DmnDeploymentResolver(RepositoryService repositoryService, int cacheSize) {
        this.repositoryService = repositoryService;
        this.documents = new LruCache<>(cacheSize);
        this.resourceNames = new LruCache<>(cacheSize);
    }

    /**
     * Resolves a reference to a decision of a deployment.
     *
     * @param deploymentId the deployment of the process definition that runs the decision task
     * @param reference    the value of {@code _activiti_dmn_table_}
     * @return the DMN document, its structure and the selected decision
     * @throws DmnResolutionException when nothing, or more than one candidate, matches
     * @throws DmnModelException      when a DMN resource of the deployment cannot be parsed
     */
    public Resolved resolve(String deploymentId, String reference) {
        if (reference == null || reference.isBlank()) {
            throw new DmnResolutionException("The decision reference is empty; set the constant "
                + DmnConnector.DECISION_TABLE_CONSTANT + " to a DMN file name, a DMN model name or a decision id");
        }
        String ref = reference.trim();
        List<String> names = dmnResourceNames(deploymentId);
        if (names.isEmpty()) {
            throw new DmnResolutionException("Deployment " + deploymentId + " contains no .dmn resource, cannot resolve '"
                + ref + "'. Add **.dmn to spring.activiti.process-definition-location-suffixes or deploy the DMN "
                + "together with the BPMN.");
        }

        // Step 1: resource base name
        String wanted = stripSuffix(ref);
        List<String> byBaseName = names.stream().filter(n -> baseName(n).equals(wanted)).toList();
        if (byBaseName.size() > 1) {
            throw ambiguous(ref, "resource base name", byBaseName);
        }
        if (byBaseName.size() == 1) {
            Parsed parsed = parse(deploymentId, byBaseName.get(0));
            return selectSink(ref, "resource base name", parsed);
        }

        // Steps 2 and 3 need every document
        List<Parsed> all = new ArrayList<>();
        for (String name : names) {
            all.add(parse(deploymentId, name));
        }

        // Step 2: definitions/@name
        List<Parsed> byDefinitionsName = all.stream().filter(p -> p.model().definitionsName().equals(ref)).toList();
        if (byDefinitionsName.size() > 1) {
            throw ambiguous(ref, "definitions name", byDefinitionsName.stream().map(p -> p.resource().name()).toList());
        }
        if (byDefinitionsName.size() == 1) {
            return selectSink(ref, "definitions name", byDefinitionsName.get(0));
        }

        // Step 3: decision id
        List<Parsed> byDecisionId = all.stream().filter(p -> p.model().decision(ref).isPresent()).toList();
        if (byDecisionId.size() > 1) {
            throw ambiguous(ref, "decision id", byDecisionId.stream().map(p -> p.resource().name()).toList());
        }
        if (byDecisionId.size() == 1) {
            Parsed parsed = byDecisionId.get(0);
            return new Resolved(parsed.resource(), parsed.model(), parsed.model().decision(ref).orElseThrow());
        }

        throw new DmnResolutionException("'" + ref + "' is neither a DMN resource name, a DMN definitions name nor a "
            + "decision id in deployment " + deploymentId + ". DMN resources: " + names.stream().map(DmnDeploymentResolver::baseName).toList()
            + "; definitions names: " + all.stream().map(p -> p.model().definitionsName()).toList()
            + "; decision ids: " + all.stream().flatMap(p -> p.model().decisions().stream()).map(DmnModel.DecisionInfo::id).toList());
    }

    /**
     * Lists the {@code .dmn} resources of a deployment.
     *
     * @param deploymentId the deployment id
     * @return the resource names as stored by the engine (absolute paths for file-system deployments)
     */
    public List<String> dmnResourceNames(String deploymentId) {
        return resourceNames.get(deploymentId, id -> repositoryService.getDeploymentResourceNames(id).stream()
            .filter(n -> n.endsWith(DMN_SUFFIX)).sorted().toList());
    }

    /** @return how many documents were found in the cache (for diagnostics and tests) */
    public long cacheHits() {
        return documents.hits();
    }

    /** @return how many documents had to be read and parsed (for diagnostics and tests) */
    public long cacheMisses() {
        return documents.misses();
    }

    /** Drops every cached document and resource list. */
    public void clearCache() {
        documents.clear();
        resourceNames.clear();
    }

    private Parsed parse(String deploymentId, String resourceName) {
        return documents.get(deploymentId + '\n' + resourceName, key -> {
            String xml;
            try (InputStream in = repositoryService.getResourceAsStream(deploymentId, resourceName)) {
                if (in == null) {
                    throw new DmnResolutionException("Resource " + resourceName + " vanished from deployment " + deploymentId);
                }
                xml = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new DmnModelException("Cannot read " + resourceName + " of deployment " + deploymentId, e);
            }
            try {
                return new Parsed(new DmnResource(resourceName, xml), DmnModel.parse(xml));
            } catch (DmnModelException e) {
                throw new DmnModelException(resourceName + ": " + e.getMessage(), e);
            }
        });
    }

    private static Resolved selectSink(String ref, String step, Parsed parsed) {
        try {
            return new Resolved(parsed.resource(), parsed.model(), parsed.model().sink());
        } catch (DmnResolutionException e) {
            throw new DmnResolutionException("'" + ref + "' matched the " + step + " of " + parsed.resource().name()
                + ", but " + e.getMessage());
        }
    }

    private static DmnResolutionException ambiguous(String ref, String step, List<String> candidates) {
        return new DmnResolutionException("'" + ref + "' is ambiguous: it matches the " + step + " of " + candidates.size()
            + " DMN resources " + candidates + ". Reference the decision by a unique decision id instead.");
    }

    /**
     * The last path segment of a resource name without the {@code .dmn} suffix.
     *
     * @param resourceName a resource name such as {@code /app/classes/processes/risk.dmn}
     * @return the base name, here {@code risk}
     */
    static String baseName(String resourceName) {
        String name = resourceName;
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        return stripSuffix(name);
    }

    private static String stripSuffix(String name) {
        return name.endsWith(DMN_SUFFIX) ? name.substring(0, name.length() - DMN_SUFFIX.length()) : name;
    }
}
