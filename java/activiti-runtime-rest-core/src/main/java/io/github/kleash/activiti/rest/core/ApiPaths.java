package io.github.kleash.activiti.rest.core;

/**
 * Paths and configuration keys of the core runtime REST API (see docs/adr/0007-runtime-rest-split-and-security.md).
 * The core API is safe to embed in a production app: the acting user is always the authenticated principal.
 */
public final class ApiPaths {

    /** Property that overrides {@link #DEFAULT_BASE_PATH}. */
    public static final String BASE_PATH_PROPERTY = "activiti.rest.base-path";

    /** Default prefix of every core endpoint. */
    public static final String DEFAULT_BASE_PATH = "/api";

    /**
     * Prefix of every core controller as a Spring placeholder, resolved against {@link #BASE_PATH_PROPERTY}. Other
     * modules that add endpoints to the same API (the dev endpoints, the modeler server) use it too, so that the whole
     * API moves with the property.
     */
    public static final String BASE = "${" + BASE_PATH_PROPERTY + ":" + DEFAULT_BASE_PATH + "}";

    /** Engine and runtime information, at the default base path. */
    public static final String ENGINE = DEFAULT_BASE_PATH + "/engine";

    private ApiPaths() {
    }
}
