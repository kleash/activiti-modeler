package io.github.kleash.activiti.dmn;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.activiti.engine.RepositoryService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import io.github.kleash.activiti.dmn.testing.FolderRepository;

/** The three-step resolution of {@code _activiti_dmn_table_} (ADR 0004) and its failure modes. */
class DmnDeploymentResolverTest {

    @TempDir
    Path folder;

    private RepositoryService repository;
    private DmnDeploymentResolver resolver;

    /** A DMN file with the given definitions name and one literal decision per id; the first id requires none. */
    private Path dmn(String relativePath, String definitionsName, String... decisionIds) throws IOException {
        StringBuilder xml = new StringBuilder("<definitions xmlns=\"https://www.omg.org/spec/DMN/20191111/MODEL/\" id=\"d\" name=\"")
            .append(definitionsName).append("\" namespace=\"n\">\n");
        for (String id : decisionIds) {
            xml.append("<decision id=\"").append(id).append("\" name=\"").append(id).append("\"><variable id=\"").append(id)
                .append("_v\" name=\"").append(id).append("\"/><literalExpression><text>1</text></literalExpression></decision>\n");
        }
        xml.append("</definitions>");
        Path file = folder.resolve(relativePath);
        Files.createDirectories(file.getParent());
        Files.writeString(file, xml.toString());
        return file;
    }

    private void deploy() {
        repository = FolderRepository.of(folder);
        resolver = new DmnDeploymentResolver(repository, 16);
    }

    private DmnDeploymentResolver.Resolved resolve(String reference) {
        return resolver.resolve(FolderRepository.DEPLOYMENT_ID, reference);
    }

    @Test
    void step1ResourceBaseNameSelectsTheSinkOfThatFileEvenForAbsolutePaths() throws IOException {
        Path file = dmn("processes/risk-model.dmn", "something else", "riskDecision");
        deploy();

        DmnDeploymentResolver.Resolved resolved = resolve("risk-model");

        assertThat(Path.of(resolved.resource().name())).as("engine-style absolute resource name").isAbsolute().isEqualTo(file.toAbsolutePath().normalize());
        assertThat(resolved.decision().id()).isEqualTo("riskDecision");
        assertThat(resolve("risk-model.dmn").decision().id()).as("the .dmn suffix is tolerated").isEqualTo("riskDecision");
    }

    @Test
    void step1ResolvesToTheSinkOfADrd() throws IOException {
        Files.createDirectories(folder.resolve("p"));
        Files.copy(Path.of("..", "..", "corpus", "C17-dmn-drd", "seed", "processes", "loan-decision.dmn"), folder.resolve("p/loan-decision.dmn"));
        deploy();

        assertThat(resolve("loan-decision").decision().id()).isEqualTo("loanOffer");
    }

    @Test
    void step1FailsWhenTheFileHasSeveralFinalDecisions() throws IOException {
        dmn("p/many.dmn", "many", "a", "b");
        deploy();

        assertThatThrownBy(() -> resolve("many")).isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("matched the resource base name of").hasMessageContaining("many.dmn")
            .hasMessageContaining("2 final decisions").hasMessageContaining("reference one of them by decision id");
    }

    @Test
    void step1IsAmbiguousWhenTwoDirectoriesHoldTheSameFileName() throws IOException {
        dmn("a/dup.dmn", "one", "d1");
        dmn("b/dup.dmn", "two", "d2");
        deploy();

        assertThatThrownBy(() -> resolve("dup")).isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("'dup' is ambiguous").hasMessageContaining("resource base name").hasMessageContaining("2 DMN resources")
            .hasMessageContaining("unique decision id");
    }

    @Test
    void step2DefinitionsNameSelectsTheSinkOfThatFile() throws IOException {
        dmn("p/file-name.dmn", "Credit Rules", "creditDecision");
        deploy();

        DmnDeploymentResolver.Resolved resolved = resolve("Credit Rules");

        assertThat(resolved.decision().id()).isEqualTo("creditDecision");
        assertThat(resolved.model().definitionsName()).isEqualTo("Credit Rules");
    }

    @Test
    void step2IsAmbiguousWhenTwoFilesShareADefinitionsName() throws IOException {
        dmn("p/one.dmn", "Same Name", "d1");
        dmn("p/two.dmn", "Same Name", "d2");
        deploy();

        assertThatThrownBy(() -> resolve("Same Name")).isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("ambiguous").hasMessageContaining("definitions name");
    }

    @Test
    void step3DecisionIdIsFoundInAnyFile() throws IOException {
        dmn("p/one.dmn", "One", "alpha", "beta");
        dmn("p/two.dmn", "Two", "gamma");
        deploy();

        DmnDeploymentResolver.Resolved resolved = resolve("gamma");

        assertThat(resolved.decision().id()).isEqualTo("gamma");
        assertThat(resolve("beta").resource().name()).endsWith("one.dmn");
    }

    @Test
    void step3IsAmbiguousWhenTwoFilesDefineTheSameDecisionId() throws IOException {
        dmn("p/one.dmn", "One", "shared");
        dmn("p/two.dmn", "Two", "shared");
        deploy();

        assertThatThrownBy(() -> resolve("shared")).isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("'shared' is ambiguous").hasMessageContaining("decision id");
    }

    @Test
    void stepsAreTriedInOrderAndAStepThatMatchesWins() throws IOException {
        // "x" is the base name of file1, the definitions name of file2 and a decision id in file3
        dmn("p/x.dmn", "other", "fromFile1");
        dmn("p/file2.dmn", "x", "fromFile2");
        dmn("p/file3.dmn", "third", "x");
        deploy();
        assertThat(resolve("x").decision().id()).isEqualTo("fromFile1");

        Files.delete(folder.resolve("p/x.dmn"));
        deploy();
        assertThat(resolve("x").decision().id()).isEqualTo("fromFile2");

        Files.delete(folder.resolve("p/file2.dmn"));
        deploy();
        assertThat(resolve("x").decision().id()).isEqualTo("x");
    }

    @Test
    void aMatchingStepDoesNotFallThroughWhenItFails() throws IOException {
        dmn("p/x.dmn", "other", "a", "b");
        dmn("p/file3.dmn", "third", "x");
        deploy();

        assertThatThrownBy(() -> resolve("x")).isInstanceOf(DmnResolutionException.class).hasMessageContaining("2 final decisions");
    }

    @Test
    void unknownReferenceListsTheCandidates() throws IOException {
        dmn("p/one.dmn", "One Model", "alpha");
        deploy();

        assertThatThrownBy(() -> resolve("nope")).isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("'nope' is neither a DMN resource name, a DMN definitions name nor a decision id")
            .hasMessageContaining("one").hasMessageContaining("One Model").hasMessageContaining("alpha");
    }

    @Test
    void blankReferenceIsRejected() throws IOException {
        dmn("p/one.dmn", "One", "alpha");
        deploy();

        assertThatThrownBy(() -> resolve("  ")).isInstanceOf(DmnResolutionException.class).hasMessageContaining(DmnConnector.DECISION_TABLE_CONSTANT);
        assertThatThrownBy(() -> resolve(null)).isInstanceOf(DmnResolutionException.class);
    }

    @Test
    void deploymentWithoutDmnResourcesExplainsHowToDeployThem() throws IOException {
        Files.writeString(folder.resolve("only.bpmn20.xml"), "<definitions/>");
        deploy();

        assertThatThrownBy(() -> resolve("anything")).isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("contains no .dmn resource").hasMessageContaining("process-definition-location-suffixes");
    }

    @Test
    void unparseableDocumentsAreReportedByNameWhenTheyMustBeSearched() throws IOException {
        dmn("p/good.dmn", "Good", "goodDecision");
        Files.writeString(folder.resolve("p/broken.dmn"), "<definitions");
        deploy();

        assertThat(resolve("good").decision().id()).as("step 1 reads only the matching file").isEqualTo("goodDecision");
        assertThatThrownBy(() -> resolve("goodDecision")).isInstanceOf(DmnModelException.class).hasMessageContaining("broken.dmn");
    }

    @Test
    void windowsStyleResourceNamesAreComparedByTheirLastSegment() throws IOException {
        Path file = dmn("p/winfile.dmn", "w", "winDecision");
        RepositoryService windows = mock(RepositoryService.class);
        when(windows.getDeploymentResourceNames("dep")).thenReturn(List.of("C:\\apps\\classes\\processes\\winfile.dmn"));
        when(windows.getResourceAsStream(anyString(), anyString()))
            .thenAnswer(i -> new ByteArrayInputStream(Files.readAllBytes(file)));

        assertThat(new DmnDeploymentResolver(windows, 4).resolve("dep", "winfile").decision().id()).isEqualTo("winDecision");
    }

    @Test
    void documentsAndResourceListsAreCachedPerDeploymentAndResource() throws IOException {
        dmn("p/one.dmn", "One", "alpha");
        deploy();

        resolve("one");
        resolve("one");
        resolve("alpha");

        verify(repository, times(1)).getDeploymentResourceNames(FolderRepository.DEPLOYMENT_ID);
        verify(repository, times(1)).getResourceAsStream(anyString(), anyString());
        assertThat(resolver.cacheMisses()).isEqualTo(1);
        assertThat(resolver.cacheHits()).isEqualTo(2);

        resolver.clearCache();
        resolve("one");
        verify(repository, times(2)).getResourceAsStream(anyString(), anyString());
    }

    @Test
    void cacheKeyIncludesTheDeploymentSoDifferentDeploymentsDoNotShareDocuments() throws IOException {
        Path v1 = dmn("v1/model.dmn", "v1", "decisionV1");
        Path v2 = dmn("v2/model.dmn", "v2", "decisionV2");
        RepositoryService repo = mock(RepositoryService.class);
        when(repo.getDeploymentResourceNames("dep-1")).thenReturn(List.of(v1.toString()));
        when(repo.getDeploymentResourceNames("dep-2")).thenReturn(List.of(v2.toString()));
        when(repo.getResourceAsStream(anyString(), anyString())).thenAnswer(i -> new ByteArrayInputStream(
            Files.readAllBytes(Path.of((String) i.getArgument(1)))));
        DmnDeploymentResolver twoDeployments = new DmnDeploymentResolver(repo, 8);

        assertThat(twoDeployments.resolve("dep-1", "model").decision().id()).isEqualTo("decisionV1");
        assertThat(twoDeployments.resolve("dep-2", "model").decision().id()).isEqualTo("decisionV2");
        assertThat(twoDeployments.resolve("dep-1", "model").decision().id()).isEqualTo("decisionV1");
    }
}
