package io.github.kleash.activiti.harness.project;

import java.nio.file.Path;
import java.util.List;

/**
 * A project to verify: models to deploy plus the hand-written oracles to check them with.
 *
 * @param id               project id, e.g. {@code C04-gateways}
 * @param origin           where it comes from
 * @param dir              the project folder (the one that holds {@code processes/})
 * @param processesDir     BPMN, DMN and {@code *-extensions.json} files to deploy
 * @param connectorsDir    connector descriptors ({@code connectors/*.json}), or {@code null}
 * @param scenarioFiles    {@code *.scenario.json} oracles, sorted by name
 * @param modelExpect      {@code model-expect.json}, or {@code null}
 * @param exemptions       {@code coverage-exemptions.json}, or {@code null}
 * @param harnessProperties {@code harness.properties}, or {@code null}: hand-written Spring properties merged into the
 *                          project's context (for example {@code activiti.dmn.engine=kie}), see docs/corpus-support.md
 */
public record Project(
        String id,
        Origin origin,
        Path dir,
        Path processesDir,
        Path connectorsDir,
        List<Path> scenarioFiles,
        Path modelExpect,
        Path exemptions,
        Path harnessProperties) {

    /** Where a project comes from. */
    public enum Origin {
        /** Hand-written seed models at {@code corpus/<id>/seed}. */
        SEED,
        /** Exported by the modeler into {@code java/verification-harness/target/corpus/<id>}. */
        GENERATED,
        /** Built through the real UI of the modeler and exported into {@code java/verification-harness/target/corpus-ui/<id>}. */
        UI,
        /** Any folder passed with {@code -Dcorpus.dir} or to the CLI. */
        DIRECTORY
    }

    public Project {
        scenarioFiles = List.copyOf(scenarioFiles);
    }

    /** A project without {@code harness.properties}. */
    public Project(String id, Origin origin, Path dir, Path processesDir, Path connectorsDir, List<Path> scenarioFiles,
                   Path modelExpect, Path exemptions) {
        this(id, origin, dir, processesDir, connectorsDir, scenarioFiles, modelExpect, exemptions, null);
    }

    @Override
    public String toString() {
        return id + " (" + origin.name().toLowerCase() + ", " + dir + ")";
    }
}
