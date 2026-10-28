package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import java.util.Map;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.verify.Check;
import io.github.kleash.activiti.harness.verify.CheckResult;
import io.github.kleash.activiti.harness.verify.ProjectVerifier;

/** Turns the checks of a project into JUnit dynamic tests and keeps the per-project summary. */
final class DynamicChecks {

    private final Map<String, int[]> summary = new ConcurrentSkipListMap<>();

    private static final Logger LOG = LoggerFactory.getLogger(DynamicChecks.class);

    /** One dynamic test per check, then one that releases the Spring context. */
    Stream<DynamicNode> checks(Project project, DeployMode mode) {
        ProjectVerifier verifier = new ProjectVerifier(project, mode);
        Stream<DynamicNode> tests = verifier.checks().stream().map(check -> dynamicTest(check.name(), () -> assertPassed(project, mode, check)));
        Stream<DynamicNode> release = Stream.of(dynamicTest("release the Spring context", verifier::close));
        return Stream.concat(tests, release).onClose(verifier::close);
    }

    /** One line per project and deploy mode: checks run and failed. */
    String summary(String title) {
        StringBuilder sb = new StringBuilder("\n" + title + " (project / deploy mode: checks, failed)\n");
        summary.forEach((key, counts) -> sb.append(String.format("  %-60s %3d checks, %d failed%n", key, counts[0], counts[1])));
        return sb.toString();
    }

    private void assertPassed(Project project, DeployMode mode, Check check) {
        CheckResult result = check.run();
        int[] counts = summary.computeIfAbsent(project.id() + " [" + project.origin().name().toLowerCase() + "] / " + mode.label(), k -> new int[2]);
        counts[0]++;
        if (!result.passed()) {
            counts[1]++;
        }
        result.notes().forEach(note -> LOG.info("{} ({}): {}", project.id(), mode.label(), note));
        if (!result.passed()) {
            AssertionError error = new AssertionError(result.message());
            if (result.cause() != null) {
                error.initCause(result.cause());
            }
            throw error;
        }
        assertThat(result.passed()).isTrue();
    }
}
