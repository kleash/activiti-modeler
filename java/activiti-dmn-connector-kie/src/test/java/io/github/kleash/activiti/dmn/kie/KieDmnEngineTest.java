package io.github.kleash.activiti.dmn.kie;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class KieDmnEngineTest {

    @Test
    void engineNameIsStable() {
        assertThat(KieDmnEngine.NAME).isEqualTo("kie-dmn");
    }
}
