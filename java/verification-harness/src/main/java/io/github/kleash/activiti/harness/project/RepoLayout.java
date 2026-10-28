package io.github.kleash.activiti.harness.project;

import java.nio.file.Files;
import java.nio.file.Path;

/** Locates the repository folders the harness reads: {@code corpus/} and the folders of the generated projects. */
public final class RepoLayout {

    private RepoLayout() {
    }

    /**
     * The repository root: {@code -Drepo.root}, else the nearest parent of the working directory that holds both
     * {@code schemas/} and {@code docs/}.
     */
    public static Path root() {
        String configured = System.getProperty("repo.root");
        if (configured != null && !configured.isBlank()) {
            return Path.of(configured).toAbsolutePath().normalize();
        }
        for (Path p = Path.of("").toAbsolutePath(); p != null; p = p.getParent()) {
            if (Files.isDirectory(p.resolve("schemas")) && Files.isDirectory(p.resolve("docs"))) {
                return p;
            }
        }
        throw new IllegalStateException("Cannot find the repository root (a folder with schemas/ and docs/) above " + Path.of("").toAbsolutePath()
                + "; pass -Drepo.root=<dir>");
    }

    /** {@code <root>/corpus}. */
    public static Path corpus() {
        return root().resolve("corpus");
    }

    /**
     * Where the modeler's corpus build exports projects: {@code -Dharness.generated.dir}, else
     * {@code java/verification-harness/target/corpus} under the repository root.
     */
    public static Path generated() {
        String configured = System.getProperty("harness.generated.dir");
        if (configured != null && !configured.isBlank()) {
            return Path.of(configured).toAbsolutePath().normalize();
        }
        return root().resolve("java").resolve("verification-harness").resolve("target").resolve("corpus");
    }

    /** Where the corpus build exports the projects it builds through the real UI: next to {@link #generated()}, {@code corpus-ui}. */
    public static Path ui() {
        return generated().resolveSibling(generated().getFileName() + "-ui");
    }
}
