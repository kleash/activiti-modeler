package io.github.kleash.activiti.scenario.testapp;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.stream.Stream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import io.github.kleash.activiti.scenario.load.ScenarioLoader;
import io.github.kleash.activiti.scenario.report.FileReport;
import io.github.kleash.activiti.scenario.report.ScenarioReport;
import io.github.kleash.activiti.scenario.run.ScenarioRunner;

/** Runs the scenario files under src/test/resources/scenarios against the embedded engine, one test per scenario. */
@SpringBootTest
class ScenarioFilesTest {

    @Autowired ScenarioRunner runner;
    @Autowired ScenarioLoader loader;

    @TestFactory
    Stream<DynamicTest> scenarioFiles() {
        return Stream.of("loan", "waits", "calls", "jobs").flatMap(name -> {
            FileReport report = runner.run(loader.load(ScenarioTestSupport.scenario(name + ".scenario.json")));
            return report.scenarios().stream().map((ScenarioReport s) -> DynamicTest.dynamicTest(name + ": " + s.name(),
                    () -> assertThat(s.passed()).describedAs(s.render()).isTrue()));
        });
    }
}
