package io.github.kleash.activiti.scenario.coverage;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import io.github.kleash.activiti.scenario.coverage.PathCoverage.Element;
import io.github.kleash.activiti.scenario.coverage.PathCoverage.Kind;
import io.github.kleash.activiti.scenario.model.CoverageExemptions;
import io.github.kleash.activiti.scenario.model.CoverageExemptions.Exemption;
import io.github.kleash.activiti.scenario.report.VisitedElements;

class PathCoverageTest {

    private static final List<Element> ELEMENTS = List.of(
            new Element("p", "start", Kind.NODE), new Element("p", "task", Kind.NODE), new Element("p", "end", Kind.NODE),
            new Element("p", "f1", Kind.FLOW), new Element("p", "f2", Kind.FLOW),
            new Element("q", "start", Kind.NODE));

    private static VisitedElements visited(String process, Set<String> nodes, Set<String> flows) {
        VisitedElements v = VisitedElements.empty();
        v.add(process, nodes, flows);
        return v;
    }

    @Test
    void everythingVisitedIsComplete() {
        VisitedElements v = visited("p", Set.of("start", "task", "end"), Set.of("f1", "f2"));
        v.add("q", Set.of("start"), Set.of());
        PathCoverage.Result result = PathCoverage.compute(ELEMENTS, v, CoverageExemptions.NONE);
        assertThat(result.complete()).isTrue();
        assertThat(result.total()).isEqualTo(6);
        assertThat(result.visited()).isEqualTo(6);
        assertThat(result.problems()).isEmpty();
    }

    @Test
    void unvisitedElementsAreReportedWithTheirProcess() {
        VisitedElements v = visited("p", Set.of("start", "end"), Set.of("f1"));
        PathCoverage.Result result = PathCoverage.compute(ELEMENTS, v, CoverageExemptions.NONE);
        assertThat(result.complete()).isFalse();
        assertThat(result.missing()).containsExactly(
                new Element("p", "task", Kind.NODE), new Element("p", "f2", Kind.FLOW), new Element("q", "start", Kind.NODE));
        assertThat(result.problems())
                .contains("Path coverage is incomplete (3 of 6 elements visited). Not visited:")
                .contains("node p/task").contains("flow p/f2").contains("node q/start")
                .contains("coverage-exemptions.json");
    }

    @Test
    void sameIdInTwoProcessesIsTrackedSeparately() {
        VisitedElements v = visited("p", Set.of("start", "task", "end"), Set.of("f1", "f2"));
        PathCoverage.Result result = PathCoverage.compute(ELEMENTS, v, CoverageExemptions.NONE);
        assertThat(result.missing()).containsExactly(new Element("q", "start", Kind.NODE));
    }

    @Test
    void exemptionsRemoveElementsFromTheMissingList() {
        VisitedElements v = visited("p", Set.of("start", "task", "end"), Set.of("f1"));
        CoverageExemptions exemptions = new CoverageExemptions(List.of(
                new Exemption("p", "f2", "the error flow cannot be taken in a test"),
                new Exemption("q", "start", "second process is only reachable through a message the engine does not send")));
        PathCoverage.Result result = PathCoverage.compute(ELEMENTS, v, exemptions);
        assertThat(result.complete()).isTrue();
        assertThat(result.exempt()).extracting(Element::id).containsExactly("f2", "start");
    }

    @Test
    void anExemptionWithoutProcessMatchesEveryProcess() {
        VisitedElements v = visited("p", Set.of("start", "task", "end"), Set.of("f1", "f2"));
        PathCoverage.Result result = PathCoverage.compute(ELEMENTS, v,
                new CoverageExemptions(List.of(new Exemption(null, "start", "never started on purpose"))));
        assertThat(result.complete()).isTrue();
    }

    @Test
    void staleAndRedundantExemptionsFail() {
        VisitedElements v = visited("p", Set.of("start", "task", "end"), Set.of("f1", "f2"));
        v.add("q", Set.of("start"), Set.of());
        CoverageExemptions exemptions = new CoverageExemptions(List.of(
                new Exemption("p", "typo", "an element that does not exist at all"),
                new Exemption("p", "f1", "visited anyway so the exemption is obsolete")));
        PathCoverage.Result result = PathCoverage.compute(ELEMENTS, v, exemptions);
        assertThat(result.complete()).isFalse();
        assertThat(result.staleExemptions()).extracting(Exemption::element).containsExactly("typo");
        assertThat(result.redundantExemptions()).extracting(Exemption::element).containsExactly("f1");
        assertThat(result.problems()).contains("names elements that do not exist").contains("p/typo")
                .contains("exempts elements that the scenarios do visit").contains("p/f1");
    }
}
