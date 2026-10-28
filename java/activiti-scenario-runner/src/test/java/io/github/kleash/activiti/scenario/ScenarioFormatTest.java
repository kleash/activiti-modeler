package io.github.kleash.activiti.scenario;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ScenarioFormatTest {

    @Test
    void scenarioFilesLiveInScenariosDirectoryWithScenarioSuffix() {
        assertThat(ScenarioFormat.DIRECTORY).isEqualTo("scenarios");
        assertThat(ScenarioFormat.FILE_SUFFIX).isEqualTo(".scenario.json");
    }
}
