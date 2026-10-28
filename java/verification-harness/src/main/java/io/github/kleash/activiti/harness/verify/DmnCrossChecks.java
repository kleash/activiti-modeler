package io.github.kleash.activiti.harness.verify;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.OperatonDmnEvaluator;
import io.github.kleash.activiti.dmn.kie.DmnCrossCheck;
import io.github.kleash.activiti.dmn.kie.KieDmnEvaluator;
import io.github.kleash.activiti.harness.context.HarnessProperties;
import io.github.kleash.activiti.harness.context.ProjectContext;
import io.github.kleash.activiti.harness.dmn.DmnEvaluationLog;
import io.github.kleash.activiti.harness.dmn.RecordingDmnEvaluator;
import io.github.kleash.activiti.harness.project.Project;

/**
 * The DMN cross-check of the corpus (ADR 0004): every decision the project's scenarios evaluated - the decision
 * tasks inside process instances and the direct {@code decisions[]} cases - is evaluated again with the same inputs on
 * the <em>other</em> DMN engine, and the result rows and matched rule ids of every decision (required decisions of a
 * DRD included) must be equal.
 *
 * <p>A project runs on Operaton unless its {@code harness.properties} selects {@code activiti.dmn.engine=kie}. The
 * other engine is then Operaton, which cannot run business knowledge models, boxed contexts and the like. For such a
 * project the check asserts that Operaton rejects each evaluation with the documented pointer to
 * {@code activiti.dmn.engine=kie} (never a wrong answer), and compares the result wherever Operaton does accept it.
 */
final class DmnCrossChecks {

    /** What Operaton's refusal of a KIE-only construct must say (docs/user-guide/dmn-conventions.md). */
    static final String KIE_ONLY_HINT = "activiti.dmn.engine=kie";

    private DmnCrossChecks() {
    }

    /** Whether the project has DMN files, so that the cross-check applies. */
    static boolean applies(Project project) {
        try (Stream<Path> walk = Files.walk(project.processesDir())) {
            return walk.anyMatch(p -> p.getFileName().toString().endsWith(".dmn"));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** The configured DMN engine of a project: {@code operaton} (default) or {@code kie}. */
    static String engineOf(Project project) {
        try {
            return HarnessProperties.load(project.harnessProperties()).getOrDefault("activiti.dmn.engine", OperatonDmnEvaluator.NAME).toLowerCase();
        } catch (IllegalStateException e) {
            // an invalid harness.properties only affects the name here; the context check fails with the real message
            return OperatonDmnEvaluator.NAME;
        }
    }

    /** The name of the check, which says which engines are compared and whether KIE-only constructs are expected. */
    static String checkName(Project project) {
        return KieDmnEvaluator.NAME.equals(engineOf(project))
                ? "DMN cross-check: KIE project, every decision evaluated here is also run on Operaton (KIE-only constructs are asserted to be rejected there with a pointer to " + KIE_ONLY_HINT + ")"
                : "DMN cross-check: every decision evaluated here gives the same rows and matched rules on KIE";
    }

    static CheckResult run(ProjectContext context) {
        DmnEvaluationLog log = context.bean(DmnEvaluationLog.class);
        DmnEvaluator used = context.bean(DmnEvaluator.class);
        DmnEvaluator primary = used instanceof RecordingDmnEvaluator recording ? recording.delegate() : used;
        boolean kiePrimary = KieDmnEvaluator.NAME.equals(primary.engineName());
        DmnEvaluator other = kiePrimary ? new OperatonDmnEvaluator() : new KieDmnEvaluator();
        DmnCrossCheck crossCheck = new DmnCrossCheck(primary, other);

        List<DmnEvaluationLog.Call> calls = log.distinctCalls();
        if (calls.isEmpty()) {
            return CheckResult.fail("The project has .dmn files but no decision was evaluated by its scenarios (" + log.calls().size()
                    + " evaluations recorded), so there is nothing to cross-check. A cross-check that compares nothing proves nothing.");
        }
        List<String> problems = new ArrayList<>();
        int agreed = 0;
        int rejected = 0;
        for (DmnEvaluationLog.Call call : calls) {
            DmnCrossCheck.Result result = crossCheck.check(call.resource(), call.decisionRef(), call.inputs());
            if (result.agree()) {
                agreed++;
            } else if (kiePrimary && result.primary() != null && result.secondary() == null && refusedAsKieOnly(result)) {
                rejected++;
            } else {
                problems.add(call + ":\n      " + String.join("\n      ", result.differences()));
            }
        }
        List<String> notes = List.of(calls.size() + " distinct evaluation(s) of " + log.calls().size() + " cross-checked between " + primary.engineName()
                + " and " + other.engineName() + ": " + agreed + " identical" + (kiePrimary ? ", " + rejected + " rejected by Operaton as KIE-only" : ""));
        if (!problems.isEmpty()) {
            return new CheckResult(false, primary.engineName() + " and " + other.engineName() + " disagree on " + problems.size() + " of "
                    + calls.size() + " evaluation(s):\n  - " + String.join("\n  - ", problems), notes, null);
        }
        return CheckResult.pass(notes);
    }

    private static boolean refusedAsKieOnly(DmnCrossCheck.Result result) {
        return result.differences().stream().anyMatch(d -> d.startsWith(OperatonDmnEvaluator.NAME + " failed:") && d.contains(KIE_ONLY_HINT));
    }
}
