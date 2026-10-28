package io.github.kleash.activiti.rest.dev.validate;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Semaphore;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.activiti.engine.ProcessEngine;
import org.activiti.engine.repository.Deployment;
import org.activiti.engine.repository.DeploymentBuilder;

import io.github.kleash.activiti.rest.dev.dto.DevDtos;

/**
 * Deploys a project into a {@link ScratchEngine} to find what only the engine's deployment step finds. If the files do not deploy
 * together, each BPMN file is tried again on its own (with all the other files), so that a failure can be attributed to a file.
 */
public final class TrialDeployer {

    private static final Pattern ELEMENT = Pattern.compile("\\bid = ([^\\s|\\]]+)");
    private static final Pattern LINE = Pattern.compile("\\( line: (\\d+), column: (\\d+)\\)");

    /** Scratch engines are not cheap; do not let a burst of requests build many at once. */
    private final Semaphore permits = new Semaphore(2);

    /**
     * @param bpmn  BPMN files that parsed and validated
     * @param other extension and DMN files that go into the same deployment
     * @return the problems, empty when the project deploys
     */
    public List<DevDtos.Problem> trial(List<DevDtos.FileEntry> bpmn, List<DevDtos.FileEntry> other) {
        if (bpmn.isEmpty()) {
            return List.of();
        }
        permits.acquireUninterruptibly();
        try (ScratchEngine scratch = new ScratchEngine()) {
            ProcessEngine engine = scratch.engine();
            List<DevDtos.FileEntry> everything = new ArrayList<>(bpmn);
            everything.addAll(other);
            Throwable together = tryDeploy(engine, everything);
            if (together == null) {
                return List.of();
            }
            List<DevDtos.Problem> problems = new ArrayList<>();
            for (DevDtos.FileEntry file : bpmn) {
                List<DevDtos.FileEntry> alone = new ArrayList<>(other);
                alone.add(file);
                Throwable failure = tryDeploy(engine, alone);
                if (failure != null) {
                    problems.add(problem(file.path(), failure));
                }
            }
            if (problems.isEmpty()) {
                // every file deploys on its own, the combination does not (duplicate keys, message names, ...)
                problems.add(problem(null, together));
            }
            return problems;
        } finally {
            permits.release();
        }
    }

    private static Throwable tryDeploy(ProcessEngine engine, List<DevDtos.FileEntry> files) {
        DeploymentBuilder builder = engine.getRepositoryService().createDeployment().name("trial");
        for (DevDtos.FileEntry file : files) {
            builder.addBytes(file.path(), file.content().getBytes(StandardCharsets.UTF_8));
        }
        Deployment deployment = null;
        try {
            deployment = builder.deploy();
            return null;
        } catch (RuntimeException e) {
            return e;
        } finally {
            if (deployment != null) {
                engine.getRepositoryService().deleteDeployment(deployment.getId(), true);
            }
        }
    }

    static DevDtos.Problem problem(String path, Throwable failure) {
        String message = describe(failure);
        Matcher element = ELEMENT.matcher(message);
        Matcher position = LINE.matcher(message);
        return new DevDtos.Problem(path, element.find() ? element.group(1) : null, "trial-deploy", "error",
                "The engine refuses to deploy this: " + message, "trial-deploy",
                position.find() ? Integer.valueOf(position.group(1)) : null, position.find(0) ? Integer.valueOf(position.group(2)) : null);
    }

    /** Class and message of the failure and of its causes, for a message a person can act on. */
    public static String describeFailure(Throwable failure) {
        return describe(failure);
    }

    /** Class and message of the failure and of its causes, for a message a person can act on. */
    static String describe(Throwable failure) {
        StringBuilder text = new StringBuilder();
        int depth = 0;
        for (Throwable t = failure; t != null && depth < 4; t = t.getCause() == t ? null : t.getCause(), depth++) {
            if (text.length() > 0) {
                text.append(" <- ");
            }
            text.append(t.getClass().getSimpleName());
            if (t.getMessage() != null) {
                text.append(": ").append(t.getMessage().strip());
            }
        }
        return text.toString();
    }
}
