package io.github.kleash.activiti.rest.dev;

import io.github.kleash.activiti.rest.core.ApiPaths;

/**
 * Switch and base path of the development-only REST endpoints (see docs/adr/0007-runtime-rest-split-and-security.md).
 * Arbitrary deployment is remote code execution, so these endpoints stay off unless explicitly enabled.
 */
public final class DevApi {

    /** Property that enables the dev endpoints; absent or false means they are not registered. */
    public static final String ENABLED_PROPERTY = "activiti.rest.dev.enabled";

    /** Prefix of every dev endpoint at the default base path. */
    public static final String BASE_PATH = ApiPaths.DEFAULT_BASE_PATH + "/dev";

    /** Prefix of every dev endpoint as a placeholder: it follows {@code activiti.rest.base-path}. */
    public static final String MAPPING = ApiPaths.BASE + "/dev";

    private DevApi() {
    }
}
