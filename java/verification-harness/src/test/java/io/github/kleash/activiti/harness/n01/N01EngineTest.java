package io.github.kleash.activiti.harness.n01;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.harness.n01.N01Layout.Source;
import io.github.kleash.activiti.harness.n01.N01Oracle.Entry;
import io.github.kleash.activiti.harness.n01.N01Oracle.Fixed;
import io.github.kleash.activiti.harness.n01.N01Oracle.Outcome;
import io.github.kleash.activiti.harness.n01.N01Runner.Case;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;
import io.github.kleash.activiti.harness.project.RepoLayout;

/**
 * The engine side of the N01 negative corpus ({@code corpus/N01-negative}, see its README): every model of {@code models/} is
 * deployed in a Spring context and H2 database of its own, and the outcome of {@code expected-engine.json} is asserted: a
 * deployment failure by validator problem key or exception, a silent degradation by running an instance and looking at what
 * happens (or does not), a hang by looking at what is left after a bounded drive with the manual job driver. Each file is a
 * dynamic test named after the file; the variants some files need (a wait state, a throwing bean) are tests of their own.
 *
 * <p>Nothing in this test sleeps: the async executor is off, and the only jobs that run are the ones a check runs.
 */
class N01EngineTest {

    private static final N01Oracle ORACLE = N01Oracle.load(N01Layout.root().resolve("expected-engine.json"));
    private static final Map<String, N01Check> CHECKS = N01Checks.all();
    private static final Map<String, String> OBSERVED = new ConcurrentSkipListMap<>();

    @TestFactory
    Stream<DynamicNode> everyModelDeploysAsTheOracleSays() {
        List<DynamicNode> tests = new ArrayList<>();
        for (String file : N01Layout.modelFiles()) {
            Entry entry = ORACLE.files().get(file);
            tests.add(dynamicTest(file, () -> {
                assertThat(entry).as("expected-engine.json has no entry for " + file).isNotNull();
                verify(file, new Source(N01Layout.models(), file), entry);
                OBSERVED.put(file, entry.outcome().name());
            }));
            if (entry != null) {
                entry.variants().forEach((name, variant) -> tests.add(dynamicTest(file + " [" + name + "]", () -> {
                    Source source = variant.file() != null ? new Source(N01Layout.variants(), variant.file()) : new Source(N01Layout.models(), file);
                    verify(file + " [" + name + "]", source, inherit(entry, variant));
                    OBSERVED.put(file + " [" + name + "]", variant.outcome().name());
                })));
            }
        }
        return tests.stream();
    }

    /**
     * For each model the modeler offers a quick fix for: the hand-written form the fix leads to (engine/fixed) deploys and runs as
     * intended. A fix whose result the engine cannot tell from the original (removing a group, a loop, an orphan key) says why it has
     * no variant.
     */
    @TestFactory
    Stream<DynamicNode> quickFixedModelsRunAsIntended() {
        List<DynamicNode> tests = new ArrayList<>();
        ORACLE.files().forEach((file, entry) -> {
            Fixed fixed = entry.fixed();
            if (fixed == null) {
                return;
            }
            tests.add(dynamicTest(file + " (quick fix)", () -> {
                assertThat(fixed.quickFix()).as("what the quick fix does").isNotBlank();
                assertThat(fixed.details()).as("what the fixed model does, or why there is none").isNotBlank();
                if (fixed.variant() == null) {
                    assertThat(fixed.check()).as("without a variant there is nothing to check").isNull();
                    return;
                }
                assertThat(fixed.check()).as("the check of the fixed model").isNotBlank();
                N01Runner.run(new Case(file + " (quick fix)", new Source(N01Layout.fixed(), fixed.variant()), List.of(), fixed.context(), fixed.helpers(),
                        Outcome.DEPLOYS_OK, null, fixed.check()), CHECKS);
                OBSERVED.put(file + " (quick fix)", "DEPLOYS_OK");
            }));
        });
        return tests.stream();
    }

    private static void verify(String label, Source source, Entry entry) throws Exception {
        N01Runner.run(new Case(label, source, entry.transform(), entry.context(), entry.helpers(), entry.outcome(), entry.deployError(), entry.check()), CHECKS);
    }

    /** A variant brings its own context and helper files, or uses the ones of the model it comes from. */
    private static Entry inherit(Entry base, Entry variant) {
        return new Entry(variant.outcome(), variant.details(), variant.evidence(), variant.check(), variant.file(),
                variant.context().isEmpty() ? base.context() : variant.context(),
                variant.helpers().isEmpty() ? base.helpers() : variant.helpers(),
                variant.transform(), variant.deployError(), Map.of(), null);
    }

    @AfterAll
    static void summary() {
        StringBuilder sb = new StringBuilder("\nN01 engine outcomes (file: outcome)\n");
        OBSERVED.forEach((file, outcome) -> sb.append(String.format("  %-62s %s%n", file, outcome)));
        System.out.println(sb);
    }

    // ---- the oracle itself ---------------------------------------------------------------------------------------------------------

    @Test
    void theOracleCoversExactlyTheModelsOfTheCorpus() {
        assertThat(ORACLE.files().keySet()).as("files of expected-engine.json vs files of models/").containsExactlyInAnyOrderElementsOf(N01Layout.modelFiles());
    }

    @Test
    void everyEntryIsWellFormed() {
        Set<String> outcomes = new TreeSet<>();
        for (Outcome o : Outcome.values()) {
            outcomes.add(o.name());
        }
        assertThat(ORACLE.documentedOutcomes()).as("the glossary of the oracle documents every outcome").containsExactlyInAnyOrderElementsOf(outcomes);

        ORACLE.files().forEach((file, entry) -> {
            checkEntry(file, entry);
            entry.variants().forEach((name, variant) -> {
                checkEntry(file + " [" + name + "]", variant);
                assertThat(variant.variants()).as(file + " [" + name + "]: variants do not nest").isEmpty();
                assertThat(variant.fixed()).as(file + " [" + name + "]: a variant has no fixed form").isNull();
                assertThat(variant.file() != null || !variant.transform().isEmpty()).as(file + " [" + name + "]: a variant is hand-written (file) or derived (transform)").isTrue();
                if (variant.file() != null) {
                    assertThat(N01Layout.variants().resolve(variant.file())).as(file + " [" + name + "]").isRegularFile();
                }
            });
        });
    }

    private static void checkEntry(String label, Entry entry) {
        assertThat(entry.outcome()).as(label + ": outcome").isNotNull();
        assertThat(entry.details()).as(label + ": details").isNotBlank();
        assertThat(entry.evidence()).as(label + ": evidence").isNotEmpty();
        if (entry.outcome() == Outcome.DEPLOY_ERROR) {
            assertThat(entry.deployError()).as(label + ": a DEPLOY_ERROR names the failure").isNotNull();
            assertThat(entry.deployError().exception() != null || !entry.deployError().problems().isEmpty() || !entry.deployError().messageContains().isEmpty())
                    .as(label + ": the failure is described").isTrue();
            assertThat(entry.check()).as(label + ": a deployment failure has no run-time check").isNull();
        } else {
            assertThat(entry.deployError()).as(label + ": only a DEPLOY_ERROR has a deployError").isNull();
            assertThat(entry.check()).as(label + ": the check that asserts the outcome").isNotBlank();
        }
        for (String c : entry.context()) {
            assertThat(N01Layout.context().resolve(c)).as(label + ": context file " + c).isRegularFile();
        }
        for (String h : entry.helpers()) {
            assertThat(N01Layout.helpers().resolve(h)).as(label + ": helper " + h).isRegularFile();
        }
    }

    @Test
    void everyCheckOfTheOracleIsRegisteredAndEveryRegisteredCheckIsUsed() {
        List<String> used = ORACLE.checkIds();
        assertThat(used).as("a check id is used once").doesNotHaveDuplicates();
        assertThat(CHECKS.keySet()).as("registered checks vs checks named in expected-engine.json").containsExactlyInAnyOrderElementsOf(used);
    }

    @Test
    void theContextOfEachModelIsTheOneTheLintOracleNames() throws IOException {
        JsonNode lint = new ObjectMapper().readTree(Files.readString(N01Layout.root().resolve("expected-lint.json"))).get("files");
        Map<String, List<String>> fromLint = new TreeMap<>();
        lint.fields().forEachRemaining(f -> {
            List<String> context = new ArrayList<>();
            f.getValue().path("context").forEach(c -> context.add(c.asText()));
            fromLint.put(f.getKey(), context);
        });
        Map<String, List<String>> fromEngine = new TreeMap<>();
        ORACLE.files().forEach((file, entry) -> {
            if (fromLint.containsKey(file)) {
                fromEngine.put(file, entry.context());
            }
        });
        assertThat(fromEngine).as("context files per model: expected-engine.json vs expected-lint.json").isEqualTo(fromLint);
    }

    @Test
    void everyModelThatTheModelerCanFixHasAFixedEntryAndNoOtherModelHas() throws IOException {
        JsonNode lint = new ObjectMapper().readTree(Files.readString(N01Layout.root().resolve("expected-lint.json"))).get("files");
        Set<String> withQuickFix = new TreeSet<>();
        lint.fields().forEachRemaining(f -> {
            if (f.getValue().has("afterFixes")) {
                withQuickFix.add(f.getKey());
            }
        });
        Set<String> withFixedEntry = new TreeSet<>();
        ORACLE.files().forEach((file, entry) -> {
            if (entry.fixed() != null) {
                withFixedEntry.add(file);
            }
        });
        assertThat(withFixedEntry).as("models with a quick fix in expected-lint.json vs models with a 'fixed' entry in expected-engine.json").isEqualTo(withQuickFix);
    }

    @Test
    void theNegativeCorpusIsNotAProjectOfThePositiveHarness() {
        assertThat(ProjectDiscovery.seeds(RepoLayout.corpus())).as("seeds: corpus/<id>/seed/processes").extracting(Project::id)
                .noneMatch(id -> id.startsWith("N01"));
        assertThat(ProjectDiscovery.generated(RepoLayout.generated(), RepoLayout.corpus())).extracting(Project::id)
                .noneMatch(id -> id.startsWith("N01"));
        assertThat(N01Layout.root().resolve("seed")).as("a seed folder would make the harness deploy invalid models").doesNotExist();
    }
}
