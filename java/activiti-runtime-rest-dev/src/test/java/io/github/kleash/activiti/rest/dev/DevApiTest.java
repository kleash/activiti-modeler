package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DevApiTest {

    @Test
    void devEndpointsAreOptInAndSeparateFromCore() {
        assertThat(DevApi.ENABLED_PROPERTY).isEqualTo("activiti.rest.dev.enabled");
        assertThat(DevApi.BASE_PATH).isEqualTo("/api/dev");
    }
}
