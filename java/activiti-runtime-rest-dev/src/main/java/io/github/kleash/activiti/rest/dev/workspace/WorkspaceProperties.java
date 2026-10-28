package io.github.kleash.activiti.rest.dev.workspace;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** {@code modeler.workspace.*}: the project folder the workspace endpoints expose. */
@ConfigurationProperties(prefix = "modeler.workspace")
public class WorkspaceProperties {

    /** The root folder. Without it the workspace endpoints answer 404 ("no workspace configured"). */
    private Path dir;

    /**
     * Name endings of the files the workspace serves and accepts: the project layout of the modeler (BPMN, DMN, the extensions and
     * connector JSON, scenarios, {@code model-expect.json}, {@code harness.properties}) and the documents next to it.
     */
    private List<String> allowedSuffixes = new ArrayList<>(List.of(".bpmn20.xml", ".bpmn", ".dmn", ".json", ".properties", ".md", ".txt", ".svg", ".png"));

    /** Largest file the workspace accepts, in bytes. */
    private long maxFileSize = 10L * 1024 * 1024;

    public Path getDir() {
        return dir;
    }

    public void setDir(Path dir) {
        this.dir = dir;
    }

    public List<String> getAllowedSuffixes() {
        return allowedSuffixes;
    }

    public void setAllowedSuffixes(List<String> allowedSuffixes) {
        this.allowedSuffixes = allowedSuffixes;
    }

    public long getMaxFileSize() {
        return maxFileSize;
    }

    public void setMaxFileSize(long maxFileSize) {
        this.maxFileSize = maxFileSize;
    }
}
