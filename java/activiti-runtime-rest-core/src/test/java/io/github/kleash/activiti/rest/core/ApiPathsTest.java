package io.github.kleash.activiti.rest.core;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ApiPathsTest {

    @Test
    void endpointsLiveUnderTheDefaultBasePath() {
        assertThat(ApiPaths.ENGINE).startsWith(ApiPaths.DEFAULT_BASE_PATH + "/");
        assertThat(ApiPaths.BASE_PATH_PROPERTY).isEqualTo("activiti.rest.base-path");
    }
}
