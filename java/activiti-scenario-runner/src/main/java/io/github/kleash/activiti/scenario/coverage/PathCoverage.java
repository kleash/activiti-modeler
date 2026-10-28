package io.github.kleash.activiti.scenario.coverage;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.activiti.bpmn.model.BpmnModel;
import org.activiti.bpmn.model.FlowElement;
import org.activiti.bpmn.model.FlowElementsContainer;
import org.activiti.bpmn.model.FlowNode;
import org.activiti.bpmn.model.Process;
import org.activiti.bpmn.model.SequenceFlow;
import org.activiti.bpmn.model.SubProcess;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.ProcessDefinition;

import io.github.kleash.activiti.scenario.model.CoverageExemptions;
import io.github.kleash.activiti.scenario.report.VisitedElements;

/**
 * Path coverage (docs/adr/0005-scenario-format.md, "Path coverage"): every flow node and every sequence flow of every
 * deployed process - boundary events, event sub processes, error ends and link events included - must be visited by
 * some scenario of the project, except the elements listed in {@code coverage-exemptions.json}.
 */
public final class PathCoverage {

    /** Kind of model element that coverage tracks. */
    public enum Kind { NODE, FLOW }

    /** One element of one process. */
    public record Element(String process, String id, Kind kind) {
        @Override public String toString() {
            return (kind == Kind.NODE ? "node " : "flow ") + process + "/" + id;
        }
    }

    /**
     * Outcome of a coverage computation.
     *
     * @param total       number of elements (flow nodes and sequence flows) of the deployed processes
     * @param visited     number of elements some scenario visited
     * @param missing     elements neither visited nor exempt
     * @param exempt      elements that are exempt and were not visited
     * @param staleExemptions exemptions that name no existing element
     * @param redundantExemptions exemptions whose elements were all visited after all (remove them)
     */
    public record Result(
            int total,
            int visited,
            List<Element> missing,
            List<Element> exempt,
            List<CoverageExemptions.Exemption> staleExemptions,
            List<CoverageExemptions.Exemption> redundantExemptions) {

        /** {@code true} when nothing is missing and every exemption is valid. */
        public boolean complete() {
            return missing.isEmpty() && staleExemptions.isEmpty() && redundantExemptions.isEmpty();
        }

        /** Human readable account of what is missing or wrong, empty when {@link #complete()}. */
        public String problems() {
            StringBuilder sb = new StringBuilder();
            if (!missing.isEmpty()) {
                sb.append("Path coverage is incomplete (").append(visited).append(" of ").append(total).append(" elements visited). Not visited:");
                missing.forEach(e -> sb.append("\n  - ").append(e));
                sb.append("\nAdd a scenario that visits them, or list them with a reason in scenarios/coverage-exemptions.json.");
            }
            if (!staleExemptions.isEmpty()) {
                sb.append(sb.isEmpty() ? "" : "\n").append("coverage-exemptions.json names elements that do not exist:");
                staleExemptions.forEach(e -> sb.append("\n  - ").append(e.process() != null ? e.process() + "/" : "").append(e.element()));
            }
            if (!redundantExemptions.isEmpty()) {
                sb.append(sb.isEmpty() ? "" : "\n").append("coverage-exemptions.json exempts elements that the scenarios do visit (remove the exemption):");
                redundantExemptions.forEach(e -> sb.append("\n  - ").append(e.process() != null ? e.process() + "/" : "").append(e.element())
                        .append(" (").append(e.reason()).append(')'));
            }
            return sb.toString();
        }
    }

    private PathCoverage() {
    }

    /**
     * Computes coverage for the given deployed definitions.
     *
     * @param repository  to read the parsed {@link BpmnModel}s
     * @param definitions the definitions that make up the project (normally the latest version of each key)
     * @param visited     what the scenarios visited, by process key
     * @param exemptions  the project's exemptions
     */
    public static Result compute(RepositoryService repository, Collection<ProcessDefinition> definitions, VisitedElements visited,
                                 CoverageExemptions exemptions) {
        List<Element> all = new ArrayList<>();
        for (ProcessDefinition definition : definitions) {
            BpmnModel model = repository.getBpmnModel(definition.getId());
            Process process = model.getProcessById(definition.getKey());
            if (process == null) {
                throw new IllegalStateException("Definition " + definition.getId() + " has no process with id " + definition.getKey());
            }
            collect(definition.getKey(), process, all);
        }
        return compute(all, visited, exemptions);
    }

    /** Computes coverage for explicitly given elements (used by tests). */
    public static Result compute(List<Element> all, VisitedElements visited, CoverageExemptions exemptions) {
        List<Element> missing = new ArrayList<>();
        List<Element> exempt = new ArrayList<>();
        int visitedCount = 0;
        Map<CoverageExemptions.Exemption, Boolean> needed = new LinkedHashMap<>();
        exemptions.exemptions().forEach(x -> needed.put(x, null));
        for (Element element : all) {
            boolean wasVisited = isVisited(visited, element);
            List<CoverageExemptions.Exemption> matching = exemptions.exemptions().stream()
                    .filter(x -> x.element().equals(element.id()) && (x.process() == null || x.process().equals(element.process()))).toList();
            for (CoverageExemptions.Exemption x : matching) {
                needed.merge(x, !wasVisited, (old, now) -> old || now);
            }
            if (wasVisited) {
                visitedCount++;
            } else if (matching.isEmpty()) {
                missing.add(element);
            } else {
                exempt.add(element);
            }
        }
        List<CoverageExemptions.Exemption> stale = new ArrayList<>();
        List<CoverageExemptions.Exemption> redundant = new ArrayList<>();
        needed.forEach((exemption, isNeeded) -> {
            if (isNeeded == null) {
                stale.add(exemption);
            } else if (!isNeeded) {
                redundant.add(exemption);
            }
        });
        return new Result(all.size(), visitedCount, missing, exempt, stale, redundant);
    }

    private static boolean isVisited(VisitedElements visited, Element element) {
        VisitedElements.Visits visits = visited.byProcess().get(element.process());
        if (visits == null) {
            return false;
        }
        return (element.kind() == Kind.NODE ? visits.nodes() : visits.flows()).contains(element.id());
    }

    private static void collect(String key, FlowElementsContainer container, List<Element> out) {
        Set<String> seen = new TreeSet<>();
        for (FlowElement element : container.getFlowElements()) {
            if (element instanceof SequenceFlow && seen.add("f:" + element.getId())) {
                out.add(new Element(key, element.getId(), Kind.FLOW));
            } else if (element instanceof FlowNode && seen.add("n:" + element.getId())) {
                out.add(new Element(key, element.getId(), Kind.NODE));
            }
            if (element instanceof SubProcess sub) {
                collect(key, sub, out);
            }
        }
    }
}
