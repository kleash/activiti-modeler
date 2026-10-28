package io.github.kleash.activiti.harness.project;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

import io.github.kleash.activiti.harness.project.Project.Origin;
import io.github.kleash.activiti.scenario.ScenarioFormat;

/**
 * Finds the projects to verify.
 *
 * <ul>
 *   <li><b>Seed</b>: {@code corpus/<id>/seed/processes/} with oracles at {@code corpus/<id>/scenarios/*.scenario.json},
 *       {@code corpus/<id>/model-expect.json}, {@code corpus/<id>/scenarios/coverage-exemptions.json} and the optional
 *       {@code corpus/<id>/harness.properties}.</li>
 *   <li><b>Generated</b>: {@code <generated>/<id>/processes/} (the modeler's export, same layout and element ids as
 *       the seed) with the oracles of {@code corpus/<id>/}.</li>
 *   <li><b>UI</b>: {@code <ui>/<id>/processes/}, the same for the projects built through the real UI of the modeler.</li>
 *   <li><b>Directory</b>: any folder with {@code processes/} and {@code scenarios/} (and optionally
 *       {@code model-expect.json} and {@code harness.properties} at the project root); or a folder whose sub folders
 *       are such projects.</li>
 * </ul>
 */
public final class ProjectDiscovery {

    public static final String PROCESSES = "processes";
    public static final String CONNECTORS = "connectors";
    public static final String MODEL_EXPECT = "model-expect.json";
    public static final String EXEMPTIONS = "coverage-exemptions.json";
    public static final String HARNESS_PROPERTIES = "harness.properties";

    private ProjectDiscovery() {
    }

    /** Seed projects under {@code corpusRoot}. */
    public static List<Project> seeds(Path corpusRoot) {
        List<Project> projects = new ArrayList<>();
        for (Path dir : children(corpusRoot)) {
            Path seed = dir.resolve("seed");
            if (Files.isDirectory(seed.resolve(PROCESSES))) {
                projects.add(project(dir.getFileName().toString(), Origin.SEED, seed, dir));
            }
        }
        return projects;
    }

    /** Projects exported by the modeler into {@code generatedRoot}; their oracles are in {@code corpusRoot/<id>}. */
    public static List<Project> generated(Path generatedRoot, Path corpusRoot) {
        return exported(generatedRoot, corpusRoot, Origin.GENERATED);
    }

    /** Projects built through the real UI of the modeler and exported into {@code uiRoot}; their oracles are in {@code corpusRoot/<id>}. */
    public static List<Project> ui(Path uiRoot, Path corpusRoot) {
        return exported(uiRoot, corpusRoot, Origin.UI);
    }

    private static List<Project> exported(Path root, Path corpusRoot, Origin origin) {
        List<Project> projects = new ArrayList<>();
        for (Path dir : children(root)) {
            if (Files.isDirectory(dir.resolve(PROCESSES))) {
                String id = dir.getFileName().toString();
                projects.add(project(id, origin, dir, corpusRoot.resolve(id)));
            }
        }
        return projects;
    }

    /** A folder that is a project itself, or whose sub folders are projects. */
    public static List<Project> directory(Path dir) {
        if (!Files.isDirectory(dir)) {
            throw new IllegalArgumentException(dir + " is not a directory");
        }
        if (Files.isDirectory(dir.resolve(PROCESSES))) {
            return List.of(project(dir.toAbsolutePath().normalize().getFileName().toString(), Origin.DIRECTORY, dir, dir));
        }
        if (Files.isDirectory(dir.resolve("seed").resolve(PROCESSES))) {
            return List.of(project(dir.toAbsolutePath().normalize().getFileName().toString(), Origin.SEED, dir.resolve("seed"), dir));
        }
        List<Project> projects = new ArrayList<>();
        for (Path child : children(dir)) {
            if (Files.isDirectory(child.resolve(PROCESSES))) {
                projects.add(project(child.getFileName().toString(), Origin.DIRECTORY, child, child));
            }
        }
        if (projects.isEmpty()) {
            projects.addAll(seeds(dir));
        }
        if (projects.isEmpty()) {
            throw new IllegalArgumentException(dir + " has no " + PROCESSES + "/ folder, and none of its sub folders has one");
        }
        return projects;
    }

    /** Keeps the projects whose id starts with one of the comma-separated prefixes (all when blank). */
    public static List<Project> filter(List<Project> projects, String prefixes) {
        if (prefixes == null || prefixes.isBlank()) {
            return projects;
        }
        List<String> wanted = List.of(prefixes.split("\\s*,\\s*"));
        return projects.stream().filter(p -> wanted.stream().anyMatch(w -> p.id().startsWith(w))).toList();
    }

    private static Project project(String id, Origin origin, Path modelDir, Path oracleDir) {
        Path scenarios = oracleDir.resolve(ScenarioFormat.DIRECTORY);
        List<Path> files = new ArrayList<>();
        if (Files.isDirectory(scenarios)) {
            try (Stream<Path> list = Files.list(scenarios)) {
                list.filter(p -> p.getFileName().toString().endsWith(ScenarioFormat.FILE_SUFFIX)).sorted().forEach(files::add);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        Path modelExpect = firstExisting(oracleDir.resolve(MODEL_EXPECT), scenarios.resolve(MODEL_EXPECT));
        Path exemptions = firstExisting(scenarios.resolve(EXEMPTIONS), oracleDir.resolve(EXEMPTIONS));
        Path connectors = Files.isDirectory(modelDir.resolve(CONNECTORS)) ? modelDir.resolve(CONNECTORS) : null;
        Path harnessProperties = firstExisting(oracleDir.resolve(HARNESS_PROPERTIES));
        return new Project(id, origin, modelDir, modelDir.resolve(PROCESSES), connectors, files, modelExpect, exemptions, harnessProperties);
    }

    private static Path firstExisting(Path... candidates) {
        for (Path p : candidates) {
            if (Files.isRegularFile(p)) {
                return p;
            }
        }
        return null;
    }

    private static List<Path> children(Path dir) {
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> list = Files.list(dir)) {
            return list.filter(Files::isDirectory).sorted(Comparator.comparing(p -> p.getFileName().toString())).toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Names of the files in a processes folder that the engine deploys (suffixes of the harness' location setting). */
    public static final Set<String> DEPLOYED_SUFFIXES = Set.of(".bpmn20.xml", ".bpmn", ".dmn", "-extensions.json");
}
