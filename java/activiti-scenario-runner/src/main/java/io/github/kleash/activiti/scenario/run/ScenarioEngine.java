package io.github.kleash.activiti.scenario.run;

import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.api.task.runtime.TaskRuntime;
import org.activiti.engine.HistoryService;
import org.activiti.engine.ManagementService;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.TaskService;
import org.springframework.security.core.userdetails.UserDetailsService;

import io.github.kleash.activiti.scenario.jobs.JobDriver;
import io.github.kleash.activiti.scenario.recording.ConnectorCallRecorder;
import io.github.kleash.activiti.scenario.recording.SequenceFlowRecorder;

/**
 * The engine a {@link ScenarioRunner} drives: the API runtimes for everything that has runtime semantics (start,
 * claim, complete, message, signal) and the engine services for what they do not offer (history, jobs and timers,
 * receive tasks, ended-instance data).
 *
 * @param processRuntime     {@code ProcessRuntime} (security applies)
 * @param taskRuntime        {@code TaskRuntime} (visibility and claim rules apply)
 * @param repositoryService  definitions, deployments, identity links of definitions
 * @param runtimeService     trigger, active activities, instance queries
 * @param taskService        read access to task details and identity links
 * @param historyService     path and ended-instance data
 * @param managementService  jobs and timers
 * @param configuration      the engine configuration (clock, history settings)
 * @param users              the identity store ({@code UserDetailsManager} when scenarios define users)
 * @param connectorCalls     recorder behind {@code expectConnectorCall}
 * @param sequenceFlows      recorder of taken sequence flows
 * @param jobDriver          timer and job driver matching the async executor setting
 * @param decisions          DMN evaluator, or {@code null} when decision cases are unsupported
 */
public record ScenarioEngine(
        ProcessRuntime processRuntime,
        TaskRuntime taskRuntime,
        RepositoryService repositoryService,
        RuntimeService runtimeService,
        TaskService taskService,
        HistoryService historyService,
        ManagementService managementService,
        ProcessEngineConfiguration configuration,
        UserDetailsService users,
        ConnectorCallRecorder connectorCalls,
        SequenceFlowRecorder sequenceFlows,
        JobDriver jobDriver,
        DecisionEvaluator decisions) {
}
