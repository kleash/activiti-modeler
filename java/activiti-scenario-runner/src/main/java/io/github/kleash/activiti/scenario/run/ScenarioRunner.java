package io.github.kleash.activiti.scenario.run;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.github.kleash.activiti.scenario.match.ValueMatcher;
import io.github.kleash.activiti.scenario.model.DecisionCase;
import io.github.kleash.activiti.scenario.model.Scenario;
import io.github.kleash.activiti.scenario.model.ScenarioFile;
import io.github.kleash.activiti.scenario.report.DecisionReport;
import io.github.kleash.activiti.scenario.report.FileReport;
import io.github.kleash.activiti.scenario.report.ScenarioReport;
import io.github.kleash.activiti.scenario.report.Status;
import io.github.kleash.activiti.scenario.report.VisitedElements;

/**
 * Executes scenario files against a running engine (docs/adr/0005-scenario-format.md).
 *
 * <p>Runtime semantics are the real ones: instances are started, tasks claimed and completed, messages and signals
 * sent through {@code ProcessRuntime} and {@code TaskRuntime} as the acting user; the engine services are used only
 * for history, jobs and timers, receive tasks and data of ended instances. Every query is scoped to the scenario's
 * instance tree, and every instance a scenario leaves active is deleted afterwards.
 *
 * <p>A runner executes one file at a time; it is not thread-safe.
 */
public final class ScenarioRunner {

    /**
     * @param timeoutMs how long {@code failJobUntilDeadLetter} waits for the executor in EXECUTOR mode
     */
    public record Options(long timeoutMs) {
        public static Options defaults() {
            return new Options(10_000);
        }
    }

    private final ScenarioEngine engine;
    private final Options options;
    private final Identity identity;

    /** Creates a runner; fails fast when the engine does not record full history. */
    public ScenarioRunner(ScenarioEngine engine, Options options) {
        EngineSettings.verify(engine.configuration());
        this.engine = engine;
        this.options = options;
        this.identity = new Identity(engine.users());
    }

    public ScenarioRunner(ScenarioEngine engine) {
        this(engine, Options.defaults());
    }

    /** Runs every scenario and decision case of {@code file}, in order, and reports on each. */
    public FileReport run(ScenarioFile file) {
        long began = System.nanoTime();
        identity.ensureRunnerUser();
        List<ScenarioReport> scenarios = new ArrayList<>();
        List<DecisionReport> decisions = new ArrayList<>();
        VisitedElements visited = VisitedElements.empty();
        try {
            identity.defineFileUsers(file.users());
            for (Scenario scenario : file.scenarios()) {
                ScenarioReport report = new ScenarioExecution(engine, identity, options, file, scenario).run();
                scenarios.add(report);
                visited.addAll(report.visited());
            }
            for (DecisionCase decision : file.decisions()) {
                decisions.add(runDecision(decision));
            }
        } finally {
            identity.removeFileUsers();
            Identity.clear();
        }
        return new FileReport(file.name(), file.source(), (System.nanoTime() - began) / 1_000_000, scenarios, decisions, visited);
    }

    private DecisionReport runDecision(DecisionCase c) {
        long began = System.nanoTime();
        List<String> failures = new ArrayList<>();
        Throwable cause = null;
        if (engine.decisions() == null) {
            failures.add("No DecisionEvaluator is configured; add the DMN connector module (or provide a DecisionEvaluator bean) to run decision cases");
        } else {
            try {
                DecisionEvaluator.Outcome outcome = engine.decisions().evaluate(c.decision(), c.inputs());
                failures.addAll(check(c, outcome));
            } catch (RuntimeException e) {
                failures.add("Evaluating decision '" + c.decision() + "' failed: " + ScenarioExecution.describe(e));
                cause = e;
            }
        }
        return new DecisionReport(c.title(), failures.isEmpty() ? Status.PASSED : Status.FAILED, (System.nanoTime() - began) / 1_000_000,
                failures, cause);
    }

    private static List<String> check(DecisionCase c, DecisionEvaluator.Outcome outcome) {
        List<String> problems = new ArrayList<>();
        if (c.result() != null) {
            List<Map<String, Object>> rows = outcome.rows();
            if (rows.size() != c.result().size()) {
                problems.add("result: expected " + c.result().size() + " row(s) but the decision returned " + rows.size() + ": " + ValueMatcher.show(rows));
            } else {
                for (int i = 0; i < rows.size(); i++) {
                    problems.addAll(ValueMatcher.matchMap("result[" + i + "]", c.result().get(i), rows.get(i), false));
                }
            }
        }
        if (c.matchedRules() != null) {
            List<String> expected = c.matchedRules().stream().sorted().toList();
            List<String> actual = outcome.matchedRules().stream().sorted().toList();
            if (!expected.equals(actual)) {
                problems.add("matchedRules: expected exactly " + expected + " but were " + actual);
            }
        }
        return problems;
    }
}
