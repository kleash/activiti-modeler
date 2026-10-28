package io.github.kleash.activiti.harness.n01;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import io.github.kleash.activiti.harness.n01.N01Oracle.Transform;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;
import io.github.kleash.activiti.harness.project.RepoLayout;

/**
 * Where the N01 negative corpus lives and how one of its models becomes an isolated project for the engine:
 *
 * <pre>
 * corpus/N01-negative/
 *   models/                  the lint corpus (hand-written, invalid on purpose); models/context/ holds what a case needs of a project
 *   expected-engine.json     the engine oracle
 *   engine/variants/         hand-written variants a check needs (a model that can run, a control)
 *   engine/fixed/            the models the quick fixes lead to
 *   engine/helpers/          models a check deploys next to the subject (a process that waits for a signal, a caller of a decision)
 * </pre>
 *
 * Every model gets a temporary project of its own ({@code processes/}, and {@code connectors/} where a case brings one), so
 * that nothing a model subscribes to, starts or declares reaches another model.
 */
final class N01Layout {

    static final String PROCESS_SUFFIX = ".bpmn20.xml";
    static final String EXTENSIONS_SUFFIX = "-extensions.json";

    private N01Layout() {
    }

    static Path root() {
        return RepoLayout.corpus().resolve("N01-negative");
    }

    static Path models() {
        return root().resolve("models");
    }

    static Path context() {
        return models().resolve("context");
    }

    static Path engine() {
        return root().resolve("engine");
    }

    static Path variants() {
        return engine().resolve("variants");
    }

    static Path fixed() {
        return engine().resolve("fixed");
    }

    static Path helpers() {
        return engine().resolve("helpers");
    }

    /** Where a model comes from: its folder and file name. */
    record Source(Path dir, String fileName) {
        Path path() {
            return dir.resolve(fileName);
        }
    }

    /**
     * Writes the project of one case into {@code target}: the model (with the text replacements applied), its extensions file,
     * the context files (relative to {@code models/context}) and the helper models (relative to {@code engine/helpers}).
     */
    static Project stage(Path target, Source source, List<Transform> transforms, List<String> context, List<String> helpers) {
        try {
            Path processes = Files.createDirectories(target.resolve(ProjectDiscovery.PROCESSES));
            String text = Files.readString(source.path());
            for (Transform t : transforms) {
                int first = text.indexOf(t.replace());
                if (first < 0 || text.indexOf(t.replace(), first + 1) >= 0) {
                    throw new IllegalStateException("The text to replace must occur exactly once in " + source.path() + ": " + t.replace());
                }
                text = text.replace(t.replace(), t.with());
            }
            Files.writeString(processes.resolve(source.fileName()), text);
            copySidecar(source.dir(), source.fileName(), processes);
            for (String c : context) {
                Path from = context().resolve(c);
                Path to = target.resolve(c);
                Files.createDirectories(to.getParent());
                Files.copy(from, to);
            }
            for (String h : helpers) {
                Files.copy(helpers().resolve(h), processes.resolve(h));
                copySidecar(helpers(), h, processes);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return ProjectDiscovery.directory(target).get(0);
    }

    /** {@code x.bpmn20.xml} is deployed with {@code x-extensions.json} when that exists next to it. */
    private static void copySidecar(Path dir, String fileName, Path processes) throws IOException {
        if (!fileName.endsWith(PROCESS_SUFFIX)) {
            return;
        }
        String sidecar = fileName.substring(0, fileName.length() - PROCESS_SUFFIX.length()) + EXTENSIONS_SUFFIX;
        if (Files.isRegularFile(dir.resolve(sidecar))) {
            Files.copy(dir.resolve(sidecar), processes.resolve(sidecar));
        }
    }

    /** The files of {@code models/} the engine oracle must cover: BPMN and DMN, not the extensions files or the context. */
    static List<String> modelFiles() {
        List<String> names = new ArrayList<>();
        try (var list = Files.list(models())) {
            list.filter(Files::isRegularFile).map(p -> p.getFileName().toString())
                    .filter(n -> n.endsWith(PROCESS_SUFFIX) || n.endsWith(".dmn")).sorted().forEach(names::add);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return names;
    }
}
