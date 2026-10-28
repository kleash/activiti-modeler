package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.activiti.bpmn.converter.BpmnXMLConverter;
import org.activiti.bpmn.model.BpmnModel;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.Deployment;
import org.activiti.validation.ValidationError;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DynamicNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.context.ProjectContext;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;
import io.github.kleash.activiti.harness.project.RepoLayout;

/**
 * The modeler's lint rules that mirror a {@code ProcessValidator} problem key claim "the engine's severity". This test holds them to
 * it: for each such rule, the hand-written {@code bad} fixtures of the rule (modeler/packages/bpmnlint-plugin-activiti/src/rules/
 * validator-*.ts, exported to {@code validator-mirror/fixtures.json} by {@code scripts/export-lint-fixtures.mjs}) go through the real
 * Activiti 9.0.0 {@code RepositoryService.validateProcess}, and where the validator does not see the problem through a trial
 * deployment. The engine must report the rule's key with the rule's severity (error or warning) for every {@code bad} fixture, and
 * none with that key for the {@code good} ones. One dynamic test per rule.
 *
 * <p>The engine runs as in the harness' contexts: standard validator set plus the async-property set (the async executor is off).
 * Differences that were investigated are listed in {@code validator-mirror/known-mismatches.json}; they are pinned there as the
 * behaviour of the engine, so that the test fails when either side changes (docs/engine-findings.md, "Validator mirror").
 */
class ValidatorMirrorTest {

    private static final Pattern KEY_IN_MESSAGE = Pattern.compile("\\( key: ([A-Z_]+) \\)");
    private static final Map<String, String> OUTCOMES = new ConcurrentSkipListMap<>();
    private static final ObjectMapper JSON = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);

    record BadFixture(String xml, List<String> ids, String note, Boolean asyncExecutorActive) {
    }

    record GoodFixture(String xml, String note, Boolean asyncExecutorActive) {
    }

    record Rule(String id, String key, String severity, List<BadFixture> bad, List<GoodFixture> good) {
    }

    record Snapshot(List<String> sources, String sourcesSha256, List<Rule> rules) {
    }

    /** An investigated difference: what the rule says, what the engine does, and why. */
    record Mismatch(String key, String severity, String engine, String why, String correctedBad, String correctedGood) {
    }

    private static Snapshot snapshot;
    private static Map<String, Mismatch> known;
    private static ProjectContext context;
    private static Path stub;

    @BeforeAll
    static void start() throws IOException {
        snapshot = JSON.readValue(ValidatorMirrorTest.class.getResourceAsStream("/validator-mirror/fixtures.json"), Snapshot.class);
        known = JSON.readValue(ValidatorMirrorTest.class.getResourceAsStream("/validator-mirror/known-mismatches.json"),
                new com.fasterxml.jackson.core.type.TypeReference<TreeMap<String, Mismatch>>() { });
        stub = Files.createTempDirectory("validator-mirror-");
        Files.createDirectories(stub.resolve("processes"));
        Files.writeString(stub.resolve("processes/stub.bpmn20.xml"), """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="urn:stub">
                  <process id="stub" isExecutable="true"><startEvent id="s"/><endEvent id="e"/><sequenceFlow id="f" sourceRef="s" targetRef="e"/></process>
                </definitions>
                """);
        context = ProjectContext.start(ProjectDiscovery.directory(stub).get(0), DeployMode.PROGRAMMATIC);
    }

    @AfterAll
    static void stop() throws IOException {
        if (context != null) {
            context.close();
        }
        try (Stream<Path> walk = Files.walk(stub)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        }
        StringBuilder sb = new StringBuilder("\nValidator mirror: rule -> engine (rule key, severity)\n");
        OUTCOMES.forEach((rule, outcome) -> sb.append(String.format("  %-60s %s%n", rule, outcome)));
        System.out.println(sb);
    }

    // ---- the snapshot --------------------------------------------------------------------------------------------------------------

    @Test
    void theSnapshotMatchesTheFixturesOfTheModeler() throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (String source : snapshot.sources()) {
            Path file = RepoLayout.root().resolve(source);
            digest.update(file.getFileName().toString().getBytes(StandardCharsets.UTF_8));
            digest.update(Files.readAllBytes(file));
        }
        assertThat(HexFormat.of().formatHex(digest.digest())).as("the validator-*.ts rule files changed after the snapshot was taken: run "
                + "`node scripts/export-lint-fixtures.mjs` and commit src/test/resources/validator-mirror/fixtures.json").isEqualTo(snapshot.sourcesSha256());
    }

    @Test
    void everyKnownMismatchNamesARuleOfTheSnapshot() {
        assertThat(snapshot.rules()).extracting(Rule::id).containsAll(known.keySet());
        known.forEach((id, m) -> assertThat(m.why()).as(id + ": why").isNotBlank());
    }

    // ---- one dynamic test per rule -------------------------------------------------------------------------------------------------

    @TestFactory
    Stream<DynamicNode> everyValidatorRuleAgreesWithTheEngine() {
        return snapshot.rules().stream().map(rule -> dynamicTest("activiti/" + rule.id() + " -> " + rule.key() + " (" + rule.severity() + ")", () -> check(rule)));
    }

    /** The three keys the Spring Boot starter adds only while the async executor is off. */
    private static final java.util.Set<String> ASYNC_KEYS = java.util.Set.of(
            "FLOW_ELEMENT_ASYNC_NOT_AVAILABLE", "EVENT_TIMER_ASYNC_NOT_AVAILABLE", "SIGNAL_ASYNC_NOT_AVAILABLE");

    private static void check(Rule rule) {
        boolean warning = "warn".equals(rule.severity());
        List<String> problems = new ArrayList<>();
        List<String> engineSaid = new ArrayList<>();

        for (int i = 0; i < rule.bad().size(); i++) {
            BadFixture fixture = rule.bad().get(i);
            Engine result = Engine.run(fixture.xml(), rule.key(), !Boolean.FALSE.equals(fixture.asyncExecutorActive()) && Boolean.TRUE.equals(fixture.asyncExecutorActive()));
            String what = "bad fixture " + i;
            engineSaid.add(what + ": " + result.describe());
            problems.addAll(badProblems(what, rule, warning, result));
        }
        for (int i = 0; i < rule.good().size(); i++) {
            GoodFixture fixture = rule.good().get(i);
            if (ASYNC_KEYS.contains(rule.key()) && fixture.asyncExecutorActive() == null) {
                continue; // "the engine's state is unknown": the rule says nothing, so the engine has nothing to confirm
            }
            Engine result = Engine.run(fixture.xml(), rule.key(), Boolean.TRUE.equals(fixture.asyncExecutorActive()));
            if (result.has(rule.key())) {
                problems.add("good fixture " + i + ": the engine reports " + rule.key() + " (" + result.describe() + ")");
            }
        }

        Mismatch mismatch = known.get(rule.id());
        if (mismatch == null) {
            OUTCOMES.put(rule.id(), problems.isEmpty() ? "agrees" : "MISMATCH");
            assertThat(problems).as("rule activiti/" + rule.id() + " (" + rule.key() + ", " + rule.severity() + ") vs the engine; bad fixtures: " + engineSaid).isEmpty();
            return;
        }
        OUTCOMES.put(rule.id(), "known mismatch: " + mismatch.engine());
        assertThat(rule.key()).as("known mismatch is about this key").isEqualTo(mismatch.key());
        assertThat(rule.severity()).as("known mismatch is about this severity of the rule").isEqualTo(mismatch.severity());
        assertThat(problems).as("rule activiti/" + rule.id() + " is a known mismatch (" + mismatch.why() + "): the difference must still be there, "
                + "else remove the entry from known-mismatches.json").isNotEmpty();
        assertThat(String.join("\n", problems)).as("the difference is the documented one").contains(mismatch.engine());
        if (mismatch.correctedBad() != null) {
            Engine result = Engine.run(mismatch.correctedBad(), rule.key(), false);
            assertThat(badProblems("corrected bad fixture", rule, warning, result)).as("with a fixture the engine accepts, it agrees with the rule: " + result.describe()).isEmpty();
        }
        if (mismatch.correctedGood() != null) {
            Engine result = Engine.run(mismatch.correctedGood(), rule.key(), false);
            assertThat(result.has(rule.key())).as("with a good fixture the engine accepts, it reports nothing: " + result.describe()).isFalse();
        }
    }

    private static List<String> badProblems(String what, Rule rule, boolean warning, Engine result) {
        if (!result.has(rule.key())) {
            return List.of(what + ": the engine does not report " + rule.key() + " (" + result.describe() + ")");
        }
        if (result.isWarning(rule.key()) != warning) {
            return List.of(what + ": the rule says " + rule.severity() + " but the engine reports " + (result.isWarning(rule.key()) ? "a warning" : "an error"));
        }
        return List.of();
    }

    // ---- the engine -------------------------------------------------------------------------------------------------------------------

    /** What the engine says about one fixture: validator findings, and the problem keys of a trial deployment. */
    private record Engine(List<ValidationError> findings, String parseError, List<String> deployedKeys, String deployFailure) {

        static Engine run(String xml, String wantedKey, boolean asyncExecutorOn) {
            RepositoryService repository = context.bean(RepositoryService.class);
            String parseError = null;
            BpmnModel model;
            try {
                model = new BpmnXMLConverter().convertToBpmnModel(() -> new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)), true, false);
            } catch (RuntimeException schemaFailure) {
                parseError = N01Chain.of(schemaFailure);
                try {
                    model = new BpmnXMLConverter().convertToBpmnModel(() -> new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)), false, false);
                } catch (RuntimeException e) {
                    return new Engine(List.of(), parseError + "\n" + N01Chain.of(e), List.of(), null);
                }
            }
            // with the async executor on, the engine validates with the standard set only; off, the starter adds its async-property set
            List<ValidationError> findings = new ArrayList<>(asyncExecutorOn
                    ? new org.activiti.validation.ProcessValidatorFactory().createDefaultProcessValidator().validate(model)
                    : repository.validateProcess(model));
            boolean seen = findings.stream().anyMatch(f -> wantedKey.equals(f.getKey()));
            List<String> keys = new ArrayList<>();
            String failure = null;
            if (!seen && !asyncExecutorOn) {
                // the validator of validateProcess does not see it: let the deployment try
                Deployment deployment = null;
                try {
                    deployment = repository.createDeployment().addString("trial.bpmn20.xml", xml).deploy();
                } catch (RuntimeException e) {
                    failure = N01Chain.of(e);
                    Matcher m = KEY_IN_MESSAGE.matcher(failure);
                    while (m.find()) {
                        keys.add(m.group(1));
                    }
                } finally {
                    if (deployment != null) {
                        repository.deleteDeployment(deployment.getId(), true);
                    }
                }
            }
            return new Engine(findings, parseError, keys, failure);
        }

        boolean has(String key) {
            return findings.stream().anyMatch(f -> key.equals(f.getKey())) || deployedKeys.contains(key);
        }

        /** Only a refused deployment tells a trial deployment's keys, and those are errors. */
        boolean isWarning(String key) {
            return findings.stream().filter(f -> key.equals(f.getKey())).anyMatch(ValidationError::isWarning)
                    && findings.stream().filter(f -> key.equals(f.getKey())).noneMatch(f -> !f.isWarning());
        }

        String describe() {
            List<String> found = findings.stream().map(f -> f.getKey() + (f.isWarning() ? " (warning)" : " (error)")).distinct().toList();
            return "validateProcess: " + found + (deployedKeys.isEmpty() ? "" : "; trial deployment refused with " + deployedKeys)
                    + (deployFailure != null && deployedKeys.isEmpty() ? "; trial deployment failed: " + firstLine(deployFailure) : "")
                    + (parseError != null ? "; parse: " + firstLine(parseError) : "");
        }

        private static String firstLine(String s) {
            String line = s.lines().findFirst().orElse(s);
            return line.length() > 200 ? line.substring(0, 200) + "..." : line;
        }
    }

    /** The cause chain of a throwable as text. */
    private static final class N01Chain {
        static String of(Throwable t) {
            StringBuilder sb = new StringBuilder();
            int depth = 0;
            for (Throwable c = t; c != null && depth < 8; c = c.getCause(), depth++) {
                sb.append(depth > 0 ? "\n  caused by " : "").append(c.getClass().getName()).append(": ").append(c.getMessage());
            }
            return sb.toString();
        }
    }
}
