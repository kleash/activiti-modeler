package io.github.kleash.activiti.harness.context;

import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.Import;

import io.github.kleash.activiti.harness.dmn.DmnRecordingConfiguration;
import io.github.kleash.activiti.harness.support.CorpusSupportConfiguration;

/**
 * The Spring configuration of one project context: embedded Activiti 9.0.0 on H2 (auto-configured), the scenario
 * runner and the DMN connector (auto-configured), the corpus support beans and the DMN evaluation log. Nothing is component scanned except the support package.
 */
@SpringBootConfiguration
@EnableAutoConfiguration
@Import({CorpusSupportConfiguration.class, DmnRecordingConfiguration.class})
public class ProjectApplication {
}
