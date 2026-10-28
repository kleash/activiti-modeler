package io.github.kleash.activiti.harness.verify;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.activiti.engine.RepositoryService;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.context.ProjectContext;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.scenario.coverage.PathCoverage;
import io.github.kleash.activiti.scenario.load.InvalidScenarioException;
import io.github.kleash.activiti.scenario.load.ScenarioLoader;
import io.github.kleash.activiti.scenario.model.CoverageExemptions;
import io.github.kleash.activiti.scenario.model.DecisionCase;
import io.github.kleash.activiti.scenario.model.ModelExpectations;
import io.github.kleash.activiti.scenario.model.Scenario;
import io.github.kleash.activiti.scenario.model.ScenarioFile;
import io.github.kleash.activiti.scenario.modelexpect.ModelExpectChecker;
import io.github.kleash.activiti.scenario.report.FileReport;
import io.github.kleash.activiti.scenario.report.ScenarioReport;
import io.github.kleash.activiti.scenario.report.VisitedElements;
import io.github.kleash.activiti.scenario.run.ScenarioRunner;

/**
 * Verifies one project in one deploy mode, in its own Spring context. {@link #checks()} lists, in the order they must
 * run: context start, deployment assertions, model validation, one check per scenario and decision case, the DMN
 * cross-check (projects with {@code .dmn} files), the {@code model-expect.json} checks and path coverage. The context is started lazily by the first check and closed by
 * {@link #close()}.
 */
public final class ProjectVerifier implements AutoCloseable {

    private final Project project;
    private final DeployMode mode;
    private final ScenarioLoader loader = new ScenarioLoader();
    private final VisitedElements visited = VisitedElements.empty();

    private ProjectContext context;
    private Throwable contextFailure;
    private boolean contextAttempted;

    public ProjectVerifier(Project project, DeployMode mode) {
        this.project = project;
        this.mode = mode;
    }

    public Project project() {
        return project;
    }

    public DeployMode mode() {
        return mode;
    }

    /** The checks in execution order. Scenario files that do not validate against the schema become failing checks. */
    public List<Check> checks() {
        List<Check> checks = new ArrayList<>();
        checks.add(named("application context starts and the project deploys", this::startContext));
        checks.add(named("deployment: resources, definitions and content", this::checkDeployment));
        checks.add(named("model validation: no warnings other than the expected ones", this::checkValidation));

        if (project.scenarioFiles().isEmpty()) {
            checks.add(named("project has scenario files", () -> CheckResult.fail("No *.scenario.json file found for project " + project.id()
                    + ". Expected them in " + project.dir().resolve("scenarios") + " (or corpus/" + project.id() + "/scenarios for seed and generated projects).")));
        }
        for (Path file : project.scenarioFiles()) {
            addScenarioChecks(checks, file);
        }
        if (DmnCrossChecks.applies(project)) {
            checks.add(named(DmnCrossChecks.checkName(project), () -> DmnCrossChecks.run(context())));
        }
        if (project.modelExpect() != null) {
            checks.add(named("model-expect.json", this::checkModelExpect));
        }
        checks.add(named("path coverage: every flow node and sequence flow is visited", this::checkCoverage));
        return checks;
    }

    private void addScenarioChecks(List<Check> checks, Path file) {
        String fileName = file.getFileName().toString();
        ScenarioFile parsed;
        try {
            parsed = loader.load(file);
        } catch (InvalidScenarioException | IllegalStateException e) {
            checks.add(named(fileName + ": valid scenario file", () -> CheckResult.fail(e.getMessage(), e)));
            return;
        }
        for (Scenario scenario : parsed.scenarios()) {
            checks.add(named(fileName + ": " + scenario.name(), () -> runScenario(parsed, scenario)));
        }
        for (DecisionCase decision : parsed.decisions()) {
            checks.add(named(fileName + ": " + decision.title(), () -> runDecision(parsed, decision)));
        }
    }

    // ---- checks -----------------------------------------------------------------------------------------------------------

    private CheckResult startContext() {
        try {
            context();
            return CheckResult.pass();
        } catch (RuntimeException e) {
            return CheckResult.fail("The Spring context for " + project.id() + " (" + mode.label() + ") did not start or the project did not deploy: " + rootMessage(e), e);
        }
    }

    private CheckResult checkDeployment() {
        ProjectContext ctx = context();
        List<String> problems = DeploymentChecks.verifyDeployment(ctx);
        return problems.isEmpty() ? CheckResult.pass() : CheckResult.fail(String.join("\n", problems));
    }

    private CheckResult checkValidation() {
        DeploymentChecks.ValidationOutcome outcome = DeploymentChecks.validate(context());
        return outcome.problems().isEmpty() ? CheckResult.pass(outcome.notes())
                : new CheckResult(false, String.join("\n", outcome.problems()), outcome.notes(), null);
    }

    private CheckResult runScenario(ScenarioFile file, Scenario scenario) {
        ProjectContext ctx = context();
        ScenarioFile single = new ScenarioFile(file.name(), file.description(), file.users(), file.clock(), List.of(scenario), List.of(), file.source());
        FileReport report = ctx.bean(ScenarioRunner.class).run(single);
        visited.addAll(report.visited());
        ScenarioReport result = report.scenarios().get(0);
        return result.passed() ? CheckResult.pass() : CheckResult.fail(result.render(), result.cause());
    }

    private CheckResult runDecision(ScenarioFile file, DecisionCase decision) {
        ProjectContext ctx = context();
        ScenarioFile single = new ScenarioFile(file.name(), file.description(), file.users(), file.clock(), List.of(), List.of(decision), file.source());
        FileReport report = ctx.bean(ScenarioRunner.class).run(single);
        var result = report.decisions().get(0);
        return result.passed() ? CheckResult.pass() : CheckResult.fail(result.render(), result.cause());
    }

    private CheckResult checkModelExpect() {
        ProjectContext ctx = context();
        ModelExpectations expectations;
        try {
            expectations = loader.loadModelExpectations(project.modelExpect());
        } catch (InvalidScenarioException e) {
            return CheckResult.fail(e.getMessage(), e);
        }
        List<String> problems = ctx.bean(ModelExpectChecker.class).check(expectations);
        return problems.isEmpty() ? CheckResult.pass() : CheckResult.fail("model-expect.json (" + project.modelExpect() + ") is not met by the parsed model:\n  - " + String.join("\n  - ", problems));
    }

    private CheckResult checkCoverage() {
        ProjectContext ctx = context();
        CoverageExemptions exemptions = CoverageExemptions.NONE;
        if (project.exemptions() != null) {
            try {
                exemptions = loader.loadExemptions(project.exemptions());
            } catch (InvalidScenarioException e) {
                return CheckResult.fail(e.getMessage(), e);
            }
        }
        PathCoverage.Result result = PathCoverage.compute(ctx.bean(RepositoryService.class), ctx.definitions(), visited, exemptions);
        return result.complete() ? CheckResult.pass(List.of(result.visited() + " of " + result.total() + " elements visited, " + result.exempt().size() + " exempt"))
                : CheckResult.fail(result.problems());
    }

    // ---- context ----------------------------------------------------------------------------------------------------------

    private ProjectContext context() {
        if (!contextAttempted) {
            contextAttempted = true;
            try {
                context = ProjectContext.start(project, mode);
            } catch (RuntimeException | Error e) {
                contextFailure = e;
            }
        }
        if (context == null) {
            throw new IllegalStateException("The application context of " + project.id() + " (" + mode.label() + ") is not available because it failed to start: "
                    + rootMessage(contextFailure), contextFailure);
        }
        return context;
    }

    @Override
    public void close() {
        if (context != null) {
            context.close();
            context = null;
        }
    }

    private Check named(String name, java.util.function.Supplier<CheckResult> body) {
        return new Check() {
            @Override public String name() { return name; }

            @Override public CheckResult run() {
                try {
                    return body.get();
                } catch (RuntimeException e) {
                    return CheckResult.fail(name + " failed with an unexpected error: " + rootMessage(e), e);
                }
            }
        };
    }

    static String rootMessage(Throwable t) {
        StringBuilder sb = new StringBuilder();
        List<Throwable> seen = new ArrayList<>();
        for (Throwable c = t; c != null && !seen.contains(c) && seen.size() < 6; c = c.getCause()) {
            seen.add(c);
            if (sb.length() > 0) {
                sb.append("\n  caused by ");
            }
            sb.append(c.getClass().getSimpleName()).append(": ").append(c.getMessage());
        }
        return sb.toString();
    }
}
