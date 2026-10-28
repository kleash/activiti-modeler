package io.github.kleash.activiti.rest.core;

import java.util.ArrayList;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code activiti.rest.*}: settings of the core runtime REST API. The library contributes no {@code SecurityFilterChain};
 * it only declares which authority an endpoint needs (docs/adr/0007-runtime-rest-split-and-security.md).
 */
@ConfigurationProperties(prefix = "activiti.rest")
public class RestCoreProperties {

    /** Switches the whole REST API off. */
    private boolean enabled = true;

    /**
     * Prefix of every endpoint. The controllers read the property themselves
     * ({@link ApiPaths#BASE_PATH_PROPERTY}); the field documents it and makes it visible to code.
     */
    private String basePath = ApiPaths.DEFAULT_BASE_PATH;

    /** Authorities (granted-authority strings, for example {@code ROLE_ACTIVITI_USER}) behind the three access levels. */
    private final Roles roles = new Roles();

    /** Page size used when a list request names none. */
    private int defaultPageSize = 20;

    /** Largest page size a list request may ask for. */
    private int maxPageSize = 200;

    /** Whether {@code GET /engine} lists the names of the Spring beans that expressions can reference. */
    private boolean exposeBeanNames = true;

    /** Memory bounds of the recorder of taken sequence flows. */
    private final SequenceFlows sequenceFlows = new SequenceFlows();

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getBasePath() {
        return basePath;
    }

    public void setBasePath(String basePath) {
        this.basePath = basePath;
    }

    public Roles getRoles() {
        return roles;
    }

    public int getDefaultPageSize() {
        return defaultPageSize;
    }

    public void setDefaultPageSize(int defaultPageSize) {
        this.defaultPageSize = defaultPageSize;
    }

    public int getMaxPageSize() {
        return maxPageSize;
    }

    public void setMaxPageSize(int maxPageSize) {
        this.maxPageSize = maxPageSize;
    }

    public boolean isExposeBeanNames() {
        return exposeBeanNames;
    }

    public void setExposeBeanNames(boolean exposeBeanNames) {
        this.exposeBeanNames = exposeBeanNames;
    }

    public SequenceFlows getSequenceFlows() {
        return sequenceFlows;
    }

    /**
     * The three access levels. They are nested: an authority of a higher level also grants the lower ones
     * ({@code admin} implies {@code operate} implies {@code read}).
     */
    public static class Roles {

        /** Authorities that may read: definitions, instances, history, tasks, jobs. */
        private List<String> read = new ArrayList<>(List.of("ROLE_ACTIVITI_USER"));

        /** Authorities that may act: start instances, work on tasks, send events, manage instances and jobs. */
        private List<String> operate = new ArrayList<>(List.of("ROLE_ACTIVITI_USER"));

        /** Authorities that may do everything, including the admin-only operations (reassigning any task, deleting history). */
        private List<String> admin = new ArrayList<>(List.of("ROLE_ACTIVITI_ADMIN"));

        public List<String> getRead() {
            return read;
        }

        public void setRead(List<String> read) {
            this.read = read;
        }

        public List<String> getOperate() {
            return operate;
        }

        public void setOperate(List<String> operate) {
            this.operate = operate;
        }

        public List<String> getAdmin() {
            return admin;
        }

        public void setAdmin(List<String> admin) {
            this.admin = admin;
        }
    }

    /** Bounds of the in-memory record of sequence flows taken. */
    public static class SequenceFlows {

        /** How many process instances the recorder remembers (least recently used are dropped). */
        private int maxInstances = 5000;

        /** How many taken flows are remembered per instance. */
        private int maxFlowsPerInstance = 2000;

        public int getMaxInstances() {
            return maxInstances;
        }

        public void setMaxInstances(int maxInstances) {
            this.maxInstances = maxInstances;
        }

        public int getMaxFlowsPerInstance() {
            return maxFlowsPerInstance;
        }

        public void setMaxFlowsPerInstance(int maxFlowsPerInstance) {
            this.maxFlowsPerInstance = maxFlowsPerInstance;
        }
    }
}
