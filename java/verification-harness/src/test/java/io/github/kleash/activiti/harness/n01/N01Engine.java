package io.github.kleash.activiti.harness.n01;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Supplier;

import org.activiti.api.task.model.builders.TaskPayloadBuilder;
import org.activiti.api.task.runtime.TaskRuntime;
import org.activiti.bpmn.converter.BpmnXMLConverter;
import org.activiti.bpmn.converter.util.InputStreamProvider;
import org.activiti.bpmn.model.BpmnModel;
import org.activiti.bpmn.model.FlowElement;
import org.activiti.bpmn.model.Process;
import org.activiti.engine.HistoryService;
import org.activiti.engine.ManagementService;
import org.activiti.engine.ProcessEngineConfiguration;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.activiti.engine.TaskService;
import org.activiti.engine.history.HistoricActivityInstance;
import org.activiti.engine.history.HistoricVariableInstance;
import org.activiti.engine.impl.identity.Authentication;
import org.activiti.engine.repository.ProcessDefinition;
import org.activiti.engine.runtime.Execution;
import org.activiti.engine.runtime.Job;
import org.activiti.engine.runtime.ProcessInstance;
import org.activiti.engine.task.Task;
import org.activiti.validation.ValidationError;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.provisioning.UserDetailsManager;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.context.ProjectContext;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.scenario.jobs.JobDriver;
import io.github.kleash.activiti.scenario.jobs.JobSupport;
import io.github.kleash.activiti.scenario.jobs.InstanceScope;

/**
 * One N01 model deployed in a context of its own, with the handful of engine operations the checks need. The async executor is
 * off (the harness' context), so jobs and timers move only when {@link #drive} or the {@link JobDriver} moves them: a check never
 * sleeps, and "nothing happens" means that no job, timer or task is left after the bounded drive.
 */
final class N01Engine implements AutoCloseable {

    /** Rounds of the manual job driver before "did not settle" is reported. */
    static final int DRIVE_ROUNDS = 25;

    final ProjectContext context;
    final RuntimeService runtime;
    final TaskService tasks;
    final HistoryService history;
    final ManagementService management;
    final RepositoryService repository;
    final ProcessEngineConfiguration configuration;
    final JobDriver driver;
    final JobSupport jobs;

    private N01Engine(ProjectContext context) {
        this.context = context;
        this.runtime = context.bean(RuntimeService.class);
        this.tasks = context.bean(TaskService.class);
        this.history = context.bean(HistoryService.class);
        this.management = context.bean(ManagementService.class);
        this.repository = context.bean(RepositoryService.class);
        this.configuration = context.bean(ProcessEngineConfiguration.class);
        this.driver = context.bean(JobDriver.class);
        this.jobs = new JobSupport(management, runtime, repository, configuration.getClock());
    }

    /** Starts the context and deploys the project (programmatic deployment); throws what the deployment throws. */
    static N01Engine start(Project project) {
        return new N01Engine(ProjectContext.start(project, DeployMode.PROGRAMMATIC));
    }

    @Override
    public void close() {
        context.close();
    }

    // ---- instances ----------------------------------------------------------------------------------------------------------

    ProcessInstance start(String key) {
        return runtime.startProcessInstanceByKey(key);
    }

    ProcessInstance start(String key, Map<String, Object> variables) {
        return runtime.startProcessInstanceByKey(key, variables);
    }

    boolean ended(String instanceId) {
        return history.createHistoricProcessInstanceQuery().processInstanceId(instanceId).finished().count() == 1;
    }

    boolean running(String instanceId) {
        return runtime.createProcessInstanceQuery().processInstanceId(instanceId).count() == 1;
    }

    /** Ids of the activities the instance has entered (finished or not), as a set: order is not guaranteed within a millisecond. */
    Set<String> visited(String instanceId) {
        Set<String> ids = new TreeSet<>();
        for (HistoricActivityInstance a : history.createHistoricActivityInstanceQuery().processInstanceId(instanceId).list()) {
            ids.add(a.getActivityId());
        }
        return ids;
    }

    /** Ids of the activities the instance waits at (the leaf executions). */
    Set<String> waitingAt(String instanceId) {
        Set<String> ids = new TreeSet<>();
        for (Execution e : runtime.createExecutionQuery().processInstanceId(instanceId).list()) {
            if (e.getActivityId() != null) {
                ids.add(e.getActivityId());
            }
        }
        return ids;
    }

    /** The process variables of an instance that is over or still running (task-local variables are not included). */
    Map<String, Object> variables(String instanceId) {
        Map<String, Object> variables = new LinkedHashMap<>();
        for (HistoricVariableInstance v : history.createHistoricVariableInstanceQuery().processInstanceId(instanceId).excludeTaskVariables().list()) {
            variables.put(v.getVariableName(), v.getValue());
        }
        return variables;
    }

    List<Task> openTasks(String instanceId) {
        return tasks.createTaskQuery().processInstanceId(instanceId).list();
    }

    /** The event subscriptions of the instance's executions, as {@code type:eventName@activityId}. */
    List<String> subscriptionsOf(String instanceId) {
        List<String> all = new ArrayList<>();
        for (Execution execution : runtime.createExecutionQuery().processInstanceId(instanceId).list()) {
            management.executeCommand(commandContext ->
                    commandContext.getEventSubscriptionEntityManager().findEventSubscriptionsByExecution(execution.getId()))
                    .forEach(s -> all.add(s.getEventType() + ":" + s.getEventName() + "@" + s.getActivityId()));
        }
        return all;
    }

    /** The instance with the given key that is still running (the one a timer or a message started, say). */
    List<ProcessInstance> instancesOf(String key) {
        return runtime.createProcessInstanceQuery().processDefinitionKey(key).list();
    }

    long finishedInstancesOf(String key) {
        return history.createHistoricProcessInstanceQuery().processDefinitionKey(key).finished().count();
    }

    // ---- the parsed model ---------------------------------------------------------------------------------------------------

    ProcessDefinition definition(String key) {
        return repository.createProcessDefinitionQuery().processDefinitionKey(key).latestVersion().singleResult();
    }

    /** The process model as the engine cached it after the parse handlers ran. */
    Process process(String key) {
        BpmnModel model = repository.getBpmnModel(definition(key).getId());
        return model.getProcessById(key);
    }

    FlowElement element(String processKey, String elementId) {
        return process(processKey).getFlowElement(elementId, true);
    }

    /**
     * The validator's findings for a BPMN file of the project, parsed fresh (a deployed definition has been rewritten by the parse
     * handlers) and validated the way the engine does at deployment. Warnings do not stop a deployment, so they are only visible here.
     */
    List<ValidationError> validate(String fileName) {
        java.nio.file.Path file = context.project().processesDir().resolve(fileName);
        BpmnModel model = new BpmnXMLConverter().convertToBpmnModel((InputStreamProvider) () -> {
            try {
                return Files.newInputStream(file);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }, true, false);
        return repository.validateProcess(model);
    }

    // ---- jobs and timers (no executor, no sleeping) ----------------------------------------------------------------------------

    InstanceScope scope(String... instanceIds) {
        return () -> Set.of(instanceIds);
    }

    /** Runs everything that is due, in the bounded rounds of the manual driver; fails when it does not settle. */
    void drive(String instanceId) {
        driver.executeJobs(scope(instanceId), DRIVE_ROUNDS, 0);
    }

    /** Executable, timer and dead-letter jobs of the instance, rendered, for "nothing is left" assertions. */
    List<String> jobsOf(String instanceId) {
        InstanceScope scope = scope(instanceId);
        List<String> all = new ArrayList<>();
        for (Job j : jobs.executableJobs(scope)) {
            all.add("executable " + j.getId() + "@" + jobs.activityOf(j));
        }
        for (Job j : jobs.timerJobs(scope)) {
            all.add("timer " + j.getId() + "@" + jobs.activityOf(j));
        }
        for (Job j : jobs.deadLetterJobs(scope)) {
            all.add("dead-letter " + j.getId() + "@" + jobs.activityOf(j));
        }
        return all;
    }

    // ---- users --------------------------------------------------------------------------------------------------------------

    /** Runs {@code action} as a user of the given groups (created on first use) through the Activiti 7 security model. */
    <T> T asUser(String name, List<String> groups, Supplier<T> action) {
        UserDetailsManager users = context.bean(UserDetailsManager.class);
        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_ACTIVITI_USER"));
        groups.forEach(g -> authorities.add(new SimpleGrantedAuthority("GROUP_" + g)));
        UserDetails details = User.withUsername(name).password("{noop}n01").authorities(authorities).build();
        if (users.userExists(name)) {
            users.updateUser(details);
        } else {
            users.createUser(details);
        }
        SecurityContext security = SecurityContextHolder.getContext();
        org.springframework.security.core.Authentication previous = security.getAuthentication();
        String previousId = Authentication.getAuthenticatedUserId();
        security.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(details, null, details.getAuthorities()));
        Authentication.setAuthenticatedUserId(name);
        try {
            return action.get();
        } finally {
            security.setAuthentication(previous);
            Authentication.setAuthenticatedUserId(previousId);
        }
    }

    /** Runs {@code action} as a user of the given groups, see {@link #asUser}. */
    void runAsUser(String name, List<String> groups, Runnable action) {
        asUser(name, groups, () -> {
            action.run();
            return null;
        });
    }

    /** Claims the task and completes it with the variables, as a member of {@code group}, through {@code TaskRuntime}. */
    void claimAndComplete(String taskId, String user, String group, Map<String, Object> variables) {
        TaskRuntime taskRuntime = context.bean(TaskRuntime.class);
        asUser(user, List.of(group), () -> {
            taskRuntime.claim(TaskPayloadBuilder.claim().withTaskId(taskId).build());
            taskRuntime.complete(TaskPayloadBuilder.complete().withTaskId(taskId).withVariables(variables).build());
            return null;
        });
    }

    // ---- failures -----------------------------------------------------------------------------------------------------------

    /** Class and message of a throwable and its causes, one per line, for failure messages and message assertions. */
    static String chain(Throwable t) {
        StringBuilder sb = new StringBuilder();
        List<Throwable> seen = new ArrayList<>();
        for (Throwable c = t; c != null && !seen.contains(c) && seen.size() < 10; c = c.getCause()) {
            seen.add(c);
            sb.append(seen.size() > 1 ? "\n  caused by " : "").append(c.getClass().getName()).append(": ").append(c.getMessage());
        }
        return sb.toString();
    }
}
