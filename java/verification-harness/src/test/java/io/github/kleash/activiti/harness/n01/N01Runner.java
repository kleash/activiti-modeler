package io.github.kleash.activiti.harness.n01;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import io.github.kleash.activiti.harness.n01.N01Layout.Source;
import io.github.kleash.activiti.harness.n01.N01Oracle.DeployError;
import io.github.kleash.activiti.harness.n01.N01Oracle.Outcome;
import io.github.kleash.activiti.harness.n01.N01Oracle.Problem;
import io.github.kleash.activiti.harness.n01.N01Oracle.Transform;
import io.github.kleash.activiti.harness.project.Project;

/**
 * Deploys one model in an isolated context and asserts the outcome the oracle states: the deployment failure for
 * {@code DEPLOY_ERROR}, the registered check for everything else.
 */
final class N01Runner {

    /** One problem of the validator in the message of the deployment failure: the extra info block has the id and the key. */
    private static final Pattern PROBLEM = Pattern.compile("\\[Extra info : ([^\\]]*)]");
    private static final Pattern ACTIVITY_ID = Pattern.compile("(?:^|\\| )id = ([^ |]*)");
    private static final Pattern KEY = Pattern.compile("\\( key: ([A-Z_]+) \\)");

    private N01Runner() {
    }

    /** What a model is deployed with and what is expected of it. */
    record Case(String label, Source source, List<Transform> transforms, List<String> context, List<String> helpers,
                Outcome outcome, DeployError deployError, String check) {
    }

    static void run(Case c, Map<String, N01Check> checks) throws Exception {
        Path temp = Files.createTempDirectory("n01-");
        try {
            Project project = N01Layout.stage(temp, c.source(), c.transforms(), c.context(), c.helpers());
            N01Engine engine;
            try {
                engine = N01Engine.start(project);
            } catch (RuntimeException | Error failure) {
                if (c.outcome() != Outcome.DEPLOY_ERROR) {
                    throw new AssertionError(c.label() + ": expected " + c.outcome() + " but the deployment failed:\n" + N01Engine.chain(failure), failure);
                }
                assertDeployError(c.label(), c.deployError(), failure);
                return;
            }
            try (engine) {
                if (c.outcome() == Outcome.DEPLOY_ERROR) {
                    throw new AssertionError(c.label() + ": expected the deployment to fail (" + c.deployError() + ") but it deployed "
                            + engine.context.definitions().stream().map(d -> d.getKey()).toList());
                }
                N01Check check = checks.get(c.check());
                if (check == null) {
                    throw new AssertionError(c.label() + ": no check registered under the id '" + c.check() + "'");
                }
                check.run(engine);
            }
        } finally {
            delete(temp);
        }
    }

    // ---- the deployment failure ------------------------------------------------------------------------------------------------

    static void assertDeployError(String label, DeployError expected, Throwable failure) {
        String chain = N01Engine.chain(failure);
        if (expected.exception() != null) {
            List<String> classes = new ArrayList<>();
            for (Throwable t = failure; t != null && classes.size() < 10; t = t.getCause()) {
                classes.add(t.getClass().getName());
            }
            assertThat(classes).as(label + ": an exception of the chain is a " + expected.exception() + "\n" + chain)
                    .anyMatch(n -> n.equals(expected.exception()) || n.endsWith("." + expected.exception()));
        }
        for (String fragment : expected.messageContains()) {
            assertThat(chain).as(label + ": the failure mentions '" + fragment + "'").contains(fragment);
        }
        if (!expected.problems().isEmpty()) {
            assertThat(validatorProblems(chain)).as(label + ": the validator problems of the failure\n" + chain)
                    .containsExactlyInAnyOrderElementsOf(expected.problems());
        }
    }

    /** The (key, activity id) of every problem the validator put into the message of the deployment failure. */
    static List<Problem> validatorProblems(String message) {
        List<Problem> problems = new ArrayList<>();
        Matcher block = PROBLEM.matcher(message);
        while (block.find()) {
            String info = block.group(1);
            Matcher key = KEY.matcher(info);
            Matcher id = ACTIVITY_ID.matcher(info);
            if (key.find()) {
                problems.add(new Problem(key.group(1), id.find() ? id.group(1) : null));
            }
        }
        return problems;
    }

    private static void delete(Path dir) {
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.delete(p);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
