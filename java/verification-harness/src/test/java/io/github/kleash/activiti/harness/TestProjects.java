package io.github.kleash.activiti.harness;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;

/** Fixture projects under {@code src/test/resources/fixtures}. */
final class TestProjects {

    private TestProjects() {
    }

    static Path fixtureDir(String name) {
        URL url = TestProjects.class.getResource("/fixtures/" + name);
        if (url == null) {
            throw new IllegalArgumentException("No fixture /fixtures/" + name);
        }
        try {
            return Path.of(url.toURI());
        } catch (URISyntaxException e) {
            throw new IllegalStateException(e);
        }
    }

    static Project fixture(String name) {
        return ProjectDiscovery.directory(fixtureDir(name)).get(0);
    }

    /** Copies a fixture into {@code target} so that a test can break it. */
    static Project copy(String name, Path target) {
        Path source = fixtureDir(name);
        try (Stream<Path> walk = Files.walk(source)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                Path destination = target.resolve(source.relativize(p).toString());
                if (Files.isDirectory(p)) {
                    Files.createDirectories(destination);
                } else {
                    Files.copy(p, destination);
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        List<Project> projects = ProjectDiscovery.directory(target);
        return projects.get(0);
    }
}
