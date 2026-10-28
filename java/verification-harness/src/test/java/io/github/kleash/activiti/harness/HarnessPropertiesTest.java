package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import io.github.kleash.activiti.dmn.DmnEvaluation;
import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.DmnResource;
import io.github.kleash.activiti.dmn.OperatonDmnEvaluator;
import io.github.kleash.activiti.dmn.DecisionEvaluation;
import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.context.HarnessProperties;
import io.github.kleash.activiti.harness.context.ProjectContext;
import io.github.kleash.activiti.harness.dmn.RecordingDmnEvaluator;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;
import io.github.kleash.activiti.harness.verify.Check;
import io.github.kleash.activiti.harness.verify.CheckResult;
import io.github.kleash.activiti.harness.verify.ProjectVerifier;

/**
 * {@code harness.properties}: per-project Spring properties (the DMN engine selection) for corpus projects and for
 * {@code verify <dir>}; and the DMN cross-check that depends on them.
 */
class HarnessPropertiesTest {

    private static final String KIE_CHECK = "DMN cross-check: KIE project, every decision evaluated here is also run on Operaton "
            + "(KIE-only constructs are asserted to be rejected there with a pointer to activiti.dmn.engine=kie)";
    private static final String OPERATON_CHECK = "DMN cross-check: every decision evaluated here gives the same rows and matched rules on KIE";

    @TempDir Path dir;

    private int copies;

    private Project miniWith(String harnessProperties) throws IOException {
        Path target = Files.createDirectories(dir.resolve("mini-" + ++copies));
        Project copy = TestProjects.copy("mini", target);
        if (harnessProperties != null) {
            Files.writeString(target.resolve("harness.properties"), harnessProperties);
        }
        return ProjectDiscovery.directory(target).get(0);
    }

    private static Map<String, CheckResult> runAll(Project project, DeployMode mode) {
        Map<String, CheckResult> results = new LinkedHashMap<>();
        try (ProjectVerifier verifier = new ProjectVerifier(project, mode)) {
            for (Check check : verifier.checks()) {
                results.put(check.name(), check.run());
            }
        }
        return results;
    }

    // ---- the file ------------------------------------------------------------------------------------------------------

    @Test
    void noFileMeansNoProperties() {
        assertThat(HarnessProperties.load(null)).isEmpty();
    }

    @Test
    void propertiesAreReadTrimmedAndSorted() throws IOException {
        Path file = Files.writeString(dir.resolve("harness.properties"), "# comment\nactiviti.dmn.engine = kie \nactiviti.dmn.cache-size=8\n");
        assertThat(HarnessProperties.load(file)).containsExactly(Map.entry("activiti.dmn.cache-size", "8"), Map.entry("activiti.dmn.engine", "kie"));
    }

    @Test
    void propertiesThatTheHarnessOwnsAreRejectedByName() throws IOException {
        Path file = Files.writeString(dir.resolve("harness.properties"),
                "activiti.dmn.engine=kie\nspring.datasource.url=jdbc:h2:mem:shared\nspring.activiti.history-level=none\n");
        assertThatThrownBy(() -> HarnessProperties.load(file))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("[spring.activiti.history-level, spring.datasource.url]")
                .hasMessageContaining("the harness owns");
    }

    // ---- discovery -----------------------------------------------------------------------------------------------------

    @Test
    void aDirectoryProjectFindsHarnessPropertiesAtItsRoot() throws IOException {
        assertThat(miniWith(null).harnessProperties()).isNull();
        Project with = miniWith("activiti.dmn.engine=kie\n");
        assertThat(with.harnessProperties()).isEqualTo(with.dir().resolve("harness.properties"));
    }

    @Test
    void theRepositorySeedOfTheKieOnlyProjectSelectsKie() {
        Project project = ProjectDiscovery.seeds(io.github.kleash.activiti.harness.project.RepoLayout.corpus()).stream()
                .filter(p -> p.id().equals("C17-dmn-drd-kie")).findFirst().orElseThrow();
        assertThat(HarnessProperties.load(project.harnessProperties())).containsEntry("activiti.dmn.engine", "kie");
    }

    // ---- effect on the context -------------------------------------------------------------------------------------------

    @Test
    void theDefaultEngineIsOperatonAndHarnessPropertiesSelectKie() throws IOException {
        try (ProjectContext operaton = ProjectContext.start(miniWith(null), DeployMode.PROGRAMMATIC)) {
            assertThat(((RecordingDmnEvaluator) operaton.bean(DmnEvaluator.class)).delegate().engineName()).isEqualTo("operaton");
        }
        try (ProjectContext kie = ProjectContext.start(miniWith("activiti.dmn.engine=kie\n"), DeployMode.PROGRAMMATIC)) {
            assertThat(((RecordingDmnEvaluator) kie.bean(DmnEvaluator.class)).delegate().engineName()).isEqualTo("kie");
        }
    }

    @Test
    void aReservedPropertyFailsTheContextCheckAndNamesTheKey() throws IOException {
        Project project = miniWith("spring.datasource.url=jdbc:h2:mem:shared\n");
        Map<String, CheckResult> results = runAll(project, DeployMode.AUTO_DEPLOY);
        assertThat(results.get("application context starts and the project deploys").message())
                .contains("did not start").contains("spring.datasource.url").contains("the harness owns");
    }

    @Test
    void verifyDirAcceptsHarnessPropertiesAtTheProjectRootAndNamesTheCrossCheckAfterTheEngine() throws IOException {
        Project project = miniWith("activiti.dmn.engine=kie\n");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int status = VerifyCli.run(new String[] {"verify", project.dir().toString(), "--mode", "auto"}, new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(new ByteArrayOutputStream(), true, StandardCharsets.UTF_8));
        assertThat(status).isZero();
        assertThat(out.toString(StandardCharsets.UTF_8)).contains("[ok]   " + KIE_CHECK).doesNotContain("[FAIL]");
    }

    // ---- the cross-check ---------------------------------------------------------------------------------------------------

    @Test
    void bothDirectionsOfTheCrossCheckPassForPortableDmn() throws IOException {
        Map<String, CheckResult> onOperaton = runAll(miniWith(null), DeployMode.PROGRAMMATIC);
        assertThat(onOperaton.get(OPERATON_CHECK).passed()).isTrue();
        assertThat(onOperaton.get(OPERATON_CHECK).notes()).singleElement().asString().contains("2 distinct evaluation(s) of 2 cross-checked between operaton and kie: 2 identical");

        Map<String, CheckResult> onKie = runAll(miniWith("activiti.dmn.engine=kie\n"), DeployMode.PROGRAMMATIC);
        assertThat(onKie.values()).allMatch(CheckResult::passed);
        assertThat(onKie.get(KIE_CHECK).notes()).singleElement().asString().contains("cross-checked between kie and operaton: 2 identical, 0 rejected by Operaton as KIE-only");
    }

    @Test
    void theCrossCheckFailsWhenTheEnginesDisagree() throws IOException {
        Project project = miniWith(null);
        System.setProperty(ProjectContext.EXTRA_CONFIG_PROPERTY, DisagreeingEvaluator.class.getName());
        try {
            Map<String, CheckResult> results = runAll(project, DeployMode.PROGRAMMATIC);
            CheckResult crossCheck = results.get(OPERATON_CHECK);
            assertThat(crossCheck.passed()).isFalse();
            assertThat(crossCheck.message()).contains("disagree on 2 of 2 evaluation(s)")
                    .contains("decision grade of ").contains("matched rules differ: [no-such-rule] vs [R1]");
            // the decision cases themselves fail too: the project's engine reports other matched rules than the scenario expects
            assertThat(results.get("mini.scenario.json: a passing score").passed()).isFalse();
        } finally {
            System.clearProperty(ProjectContext.EXTRA_CONFIG_PROPERTY);
        }
    }

    @Test
    void aProjectWithDmnFilesButNoEvaluationHasNothingToCrossCheckAndFails() throws IOException {
        Project project = miniWith(null);
        Path scenario = project.scenarioFiles().get(0);
        String content = Files.readString(scenario);
        Files.writeString(scenario, content.substring(0, content.indexOf("  ],\n  \"decisions\"")) + "  ]\n}\n");

        Map<String, CheckResult> results = runAll(project, DeployMode.PROGRAMMATIC);

        assertThat(results.get(OPERATON_CHECK).passed()).isFalse();
        assertThat(results.get(OPERATON_CHECK).message()).contains("no decision was evaluated by its scenarios").contains("proves nothing");
    }

    /** Extra Spring configuration (-Dharness.extra-config) whose DMN engine reports a rule id that does not exist. */
    @org.springframework.context.annotation.Configuration(proxyBeanMethods = false)
    public static class DisagreeingEvaluator {
        @org.springframework.context.annotation.Bean
        public DmnEvaluator dmnEvaluator() {
            OperatonDmnEvaluator real = new OperatonDmnEvaluator();
            return new DmnEvaluator() {
                @Override
                public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
                    DmnEvaluation honest = real.evaluate(dmn, decisionRef, inputs);
                    List<DecisionEvaluation> lying = honest.decisions().stream().map(d -> new DecisionEvaluation(d.decisionId(), d.decisionName(),
                            d.kind(), d.hitPolicy(), d.aggregation(), d.multiResult(), d.resultName(), d.rows(),
                            d.matchedRules().isEmpty() ? d.matchedRules() : List.of("no-such-rule"))).toList();
                    return new DmnEvaluation(lying.get(lying.size() - 1), lying);
                }

                @Override
                public String engineName() {
                    return "operaton";
                }
            };
        }
    }
}
