package io.github.kleash.activiti.dmn.testing;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.activiti.engine.RepositoryService;

/**
 * A {@link RepositoryService} stand-in that serves the files of a folder as the resources of one deployment, named by
 * absolute path like Spring's auto-deployment does. It lets resolver and cross-check tests run without an engine.
 */
public final class FolderRepository {

    /** The deployment id the stand-in knows. */
    public static final String DEPLOYMENT_ID = "dep-1";

    private FolderRepository() {
    }

    /**
     * @param folder the folder whose files (recursively) are the deployment's resources
     * @return a mock repository service for the deployment {@value #DEPLOYMENT_ID}
     */
    public static RepositoryService of(Path folder) {
        List<String> names;
        try (Stream<Path> files = Files.walk(folder)) {
            names = files.filter(Files::isRegularFile).map(p -> p.toAbsolutePath().normalize().toString()).sorted().toList();
        } catch (IOException e) {
            throw new IllegalStateException("Cannot list " + folder, e);
        }
        return of(names);
    }

    /**
     * @param absoluteResourceNames the resources of the deployment, each an existing file
     * @return a mock repository service for the deployment {@value #DEPLOYMENT_ID}
     */
    public static RepositoryService of(List<String> absoluteResourceNames) {
        RepositoryService repository = mock(RepositoryService.class);
        when(repository.getDeploymentResourceNames(DEPLOYMENT_ID)).thenReturn(absoluteResourceNames);
        when(repository.getResourceAsStream(anyString(), anyString())).thenAnswer(invocation -> {
            String name = invocation.getArgument(1);
            return absoluteResourceNames.contains(name) ? new FileInputStream(name) : null;
        });
        return repository;
    }
}
