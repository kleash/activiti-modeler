package io.github.kleash.activiti.scenario.run;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.activiti.api.process.model.ProcessInstance;
import org.activiti.api.process.model.builders.MessagePayloadBuilder;
import org.activiti.api.process.model.builders.ProcessPayloadBuilder;
import org.activiti.api.runtime.shared.query.Pageable;
import org.activiti.api.task.model.builders.TaskPayloadBuilder;
import org.activiti.engine.history.HistoricActivityInstance;
import org.activiti.engine.history.HistoricProcessInstance;
import org.activiti.engine.runtime.Execution;
import org.activiti.engine.runtime.Job;
import org.activiti.engine.task.IdentityLink;
import org.activiti.engine.task.IdentityLinkType;
import org.activiti.engine.task.Task;

import io.github.kleash.activiti.scenario.jobs.JobSupport;
import io.github.kleash.activiti.scenario.match.ValueMatcher;
import io.github.kleash.activiti.scenario.model.DeadLetterExpectation;
import io.github.kleash.activiti.scenario.model.Expect;
import io.github.kleash.activiti.scenario.model.Scenario;
import io.github.kleash.activiti.scenario.model.ScenarioFile;
import io.github.kleash.activiti.scenario.model.Start;
import io.github.kleash.activiti.scenario.model.Step;
import io.github.kleash.activiti.scenario.recording.ConnectorCall;
import io.github.kleash.activiti.scenario.report.ScenarioReport;
import io.github.kleash.activiti.scenario.report.Status;
import io.github.kleash.activiti.scenario.report.StepReport;
import io.github.kleash.activiti.scenario.report.VisitedElements;

/**
 * One run of one scenario: start, steps, final expectations, cleanup. A new instance per scenario.
 * Everything it reads is scoped to the scenario's {@link InstanceTree}.
 */
final class ScenarioExecution {

    /** A failed assertion or an unmet precondition of a step: the message says what was expected and what was found. */
    static final class Failure extends RuntimeException {
        Failure(String message) {
            super(message);
        }
    }

    private static final int DEFAULT_MAX_ROUNDS = 100;
    private static final int DEFAULT_MAX_ATTEMPTS = 20;

    private final ScenarioEngine engine;
    private final Identity identity;
    private final ScenarioRunner.Options options;
    private final ScenarioFile file;
    private final Scenario scenario;
    private final Inspector inspect;
    private final JobSupport jobSupport;

    private final List<StepReport> steps = new ArrayList<>();
    private final List<String> failures = new ArrayList<>();
    private Throwable cause;
    private Set<String> knownBefore = Set.of();
    private InstanceTree tree;
    private String rootId;
    private String actingUser;

    ScenarioExecution(ScenarioEngine engine, Identity identity, ScenarioRunner.Options options, ScenarioFile file, Scenario scenario) {
        this.engine = engine;
        this.identity = identity;
        this.options = options;
        this.file = file;
        this.scenario = scenario;
        this.inspect = new Inspector(engine);
        this.jobSupport = new JobSupport(engine.managementService(), engine.runtimeService(), engine.repositoryService(),
                engine.configuration().getClock());
    }

    // ---- run ----------------------------------------------------------------------------------------------------------

    ScenarioReport run() {
        long began = System.nanoTime();
        VisitedElements visited = VisitedElements.empty();
        try {
            setClock();
            knownBefore = historicInstanceIds();
            boolean started = runStart();
            if (started && scenario.start().expectFailure() == null) {
                boolean allPassed = runSteps();
                if (allPassed && scenario.expect() != null) {
                    checkExpect(scenario.expect());
                }
            }
        } catch (RuntimeException e) {
            failures.add("Unexpected error while running the scenario: " + describe(e));
            cause = e;
        } finally {
            visited = collectVisited(visited);
            cleanup();
        }
        long millis = (System.nanoTime() - began) / 1_000_000;
        return new ScenarioReport(scenario.name(), failures.isEmpty() ? Status.PASSED : Status.FAILED, millis, rootId,
                List.copyOf(steps), List.copyOf(failures), visited, cause);
    }

    private void setClock() {
        Instant clock = scenario.clock() != null ? scenario.clock() : file.clock();
        if (clock != null) {
            engine.configuration().getClock().setCurrentTime(Date.from(clock));
        } else {
            engine.configuration().getClock().reset();
        }
    }

    private boolean runStart() {
        Start start = scenario.start();
        actingUser = start.user() != null ? start.user() : Identity.RUNNER_USER;
        long began = System.nanoTime();
        String description = start.describe();
        try {
            if (start.expectFailure() != null) {
                expectFailure(start.expectFailure(), description, this::startInstance);
                record(0, "start", description, Status.PASSED, null, began);
                return true;
            }
            startInstance();
            record(0, "start", description, Status.PASSED, null, began);
            return true;
        } catch (Failure f) {
            record(0, "start", description, Status.FAILED, f.getMessage(), began);
            failures.add("start: " + f.getMessage());
        } catch (RuntimeException e) {
            record(0, "start", description, Status.FAILED, describe(e), began);
            failures.add("start (" + description + "): " + describe(e));
            cause = e;
        }
        scenario.steps().forEach(s -> steps.add(new StepReport(steps.size(), s.type(), s.describe(), Status.SKIPPED, null, 0)));
        return false;
    }

    private void startInstance() {
        Start start = scenario.start();
        switch (start.kind()) {
            case PROCESS -> {
                ProcessInstance instance = identity.runAs(actingUser, () -> engine.processRuntime().start(ProcessPayloadBuilder.start()
                        .withProcessDefinitionKey(start.process())
                        .withBusinessKey(start.businessKey())
                        .withVariables(start.variables())
                        .build()));
                useRoot(instance.getId());
            }
            case MESSAGE -> {
                ProcessInstance instance = identity.runAs(actingUser, () -> engine.processRuntime().start(MessagePayloadBuilder.start(start.message())
                        .withBusinessKey(start.businessKey())
                        .withVariables(start.variables())
                        .build()));
                useRoot(instance.getId());
            }
            case SIGNAL -> {
                requireNone(start.businessKey(), "businessKey", "a signal start");
                identity.runAs(actingUser, () -> engine.processRuntime().signal(ProcessPayloadBuilder.signal()
                        .withName(start.signal())
                        .withVariables(start.variables())
                        .build()));
                useRoot(onlyNewRoot("signal '" + start.signal() + "'", start.process(), knownBefore));
            }
            case TIMER -> {
                requireNone(start.businessKey(), "businessKey", "a timer start");
                if (!start.variables().isEmpty()) {
                    throw new Failure("A timer start event cannot receive start variables; remove \"variables\" from start");
                }
                // a start timer the executor is running (it was due) creates an instance that is not the scenario's
                engine.jobDriver().awaitStartTimer(start.process(), start.timer());
                Set<String> beforeTimer = historicInstanceIds();
                engine.jobDriver().fireStartTimer(start.process(), start.timer());
                useRoot(onlyNewRoot("timer '" + start.timer() + "'", start.process(), beforeTimer));
            }
            default -> throw new IllegalStateException("unreachable");
        }
    }

    private void requireNone(Object value, String field, String what) {
        if (value != null) {
            throw new Failure(what + " cannot take a " + field + "; remove it from start");
        }
    }

    private void useRoot(String id) {
        rootId = id;
        tree = new InstanceTree(engine.historyService(), id);
    }

    /** The one new root-level instance created by a signal or timer start. */
    private String onlyNewRoot(String trigger, String processKey, Set<String> before) {
        List<HistoricProcessInstance> created = engine.historyService().createHistoricProcessInstanceQuery().list().stream()
                .filter(i -> !before.contains(i.getId()))
                .filter(i -> i.getSuperProcessInstanceId() == null)
                .filter(i -> processKey == null || processKey.equals(i.getProcessDefinitionKey()))
                .toList();
        if (created.isEmpty()) {
            throw new Failure("The " + trigger + " created no process instance" + (processKey != null ? " of process '" + processKey + "'" : "")
                    + ". Is there a matching start event in a deployed process?");
        }
        if (created.size() > 1) {
            throw new Failure("The " + trigger + " created " + created.size() + " process instances (processes "
                    + created.stream().map(HistoricProcessInstance::getProcessDefinitionKey).toList()
                    + "); name the one the scenario follows with start.process");
        }
        return created.get(0).getId();
    }

    private Set<String> historicInstanceIds() {
        Set<String> ids = new LinkedHashSet<>();
        engine.historyService().createHistoricProcessInstanceQuery().list().forEach(i -> ids.add(i.getId()));
        return ids;
    }

    private boolean runSteps() {
        List<Step> list = scenario.steps();
        for (int i = 0; i < list.size(); i++) {
            Step step = list.get(i);
            int index = i + 1;
            long began = System.nanoTime();
            try {
                execute(step);
                record(index, step.type(), step.describe(), Status.PASSED, null, began);
            } catch (Failure f) {
                fail(index, step, f.getMessage(), began, null);
                skipRest(list, i + 1);
                return false;
            } catch (RuntimeException e) {
                fail(index, step, describe(e), began, e);
                skipRest(list, i + 1);
                return false;
            }
        }
        return true;
    }

    private void fail(int index, Step step, String message, long began, Throwable t) {
        record(index, step.type(), step.describe(), Status.FAILED, message, began);
        failures.add("step " + index + " (" + step.describe() + "): " + message);
        if (t != null) {
            cause = t;
        }
    }

    private void skipRest(List<Step> list, int from) {
        for (int j = from; j < list.size(); j++) {
            steps.add(new StepReport(j + 1, list.get(j).type(), list.get(j).describe(), Status.SKIPPED, null, 0));
        }
    }

    private void record(int index, String type, String description, Status status, String message, long beganNanos) {
        steps.add(new StepReport(index, type, description, status, message, (System.nanoTime() - beganNanos) / 1_000_000));
    }

    // ---- steps --------------------------------------------------------------------------------------------------------

    private void execute(Step step) {
        switch (step) {
            case Step.ExpectTask s -> expectTask(s);
            case Step.Claim s -> {
                Task task = single(s.activity(), s.match());
                identity.runAs(s.user(), () -> engine.taskRuntime().claim(TaskPayloadBuilder.claim().withTaskId(task.getId()).build()));
            }
            case Step.Release s -> {
                Task task = single(s.activity(), s.match());
                identity.runAs(s.user(), () -> engine.taskRuntime().release(TaskPayloadBuilder.release().withTaskId(task.getId()).build()));
            }
            case Step.Assign s -> {
                Task task = single(s.activity(), s.match());
                identity.runAs(s.user(), () -> engine.taskRuntime().assign(
                        TaskPayloadBuilder.assign().withTaskId(task.getId()).withAssignee(s.assignee()).build()));
            }
            case Step.CompleteTask s -> completeTask(s);
            case Step.ExpectConnectorCall s -> expectConnectorCall(s);
            case Step.ExpectChildInstance s -> expectChildInstance(s);
            case Step.Message s -> {
                String user = s.user() != null ? s.user() : actingUser;
                expectFailure(s.expectFailure(), "message '" + s.name() + "'", () -> identity.runAs(user, () -> engine.processRuntime().receive(
                        MessagePayloadBuilder.receive(s.name()).withCorrelationKey(s.correlationKey()).withVariables(s.variables()).build())));
            }
            case Step.Signal s -> {
                String user = s.user() != null ? s.user() : actingUser;
                identity.runAs(user, () -> engine.processRuntime().signal(
                        ProcessPayloadBuilder.signal().withName(s.name()).withVariables(s.variables()).build()));
            }
            case Step.TriggerReceiveTask s -> triggerReceiveTask(s);
            case Step.ExpectTimer s -> expectTimer(s);
            case Step.FireTimer s -> engine.jobDriver().fireTimer(tree, s.activity(), s.all());
            case Step.AdvanceClock s -> {
                Instant now = engine.configuration().getClock().getCurrentTime().toInstant();
                try {
                    engine.configuration().getClock().setCurrentTime(Date.from(Durations.plus(now, s.duration())));
                } catch (IllegalArgumentException e) {
                    throw new Failure(e.getMessage());
                }
            }
            case Step.ExecuteJobs s -> engine.jobDriver().executeJobs(tree,
                    s.maxRounds() != null ? s.maxRounds() : DEFAULT_MAX_ROUNDS, s.timeoutMs() != null ? s.timeoutMs() : 0);
            case Step.FailJobUntilDeadLetter s -> engine.jobDriver().failJobUntilDeadLetter(tree, s.activity(),
                    s.maxAttempts() != null ? s.maxAttempts() : DEFAULT_MAX_ATTEMPTS, options.timeoutMs());
            case Step.ExpectActive s -> expectActive(s);
            case Step.SetVariables s -> {
                if (!inspect.isRunning(rootId)) {
                    throw new Failure("The root instance has ended; setVariables needs a running instance");
                }
                identity.runAs(actingUser, () -> engine.processRuntime().setVariables(
                        ProcessPayloadBuilder.setVariables(rootId).withVariables(s.variables()).build()));
            }
        }
    }

    // ---- tasks --------------------------------------------------------------------------------------------------------

    private List<Task> tasksAt(String activity) {
        List<Task> tasks = new ArrayList<>(engine.taskService().createTaskQuery()
                .processInstanceIdIn(new ArrayList<>(tree.instanceIds()))
                .taskDefinitionKey(activity)
                .includeTaskLocalVariables()
                .list());
        tasks.sort(Comparator.comparing(Task::getCreateTime).thenComparing(Task::getId, Inspector::compareIds));
        return tasks;
    }

    private List<Task> allOpenTasks() {
        List<Task> tasks = new ArrayList<>(engine.taskService().createTaskQuery()
                .processInstanceIdIn(new ArrayList<>(tree.instanceIds())).list());
        tasks.sort(Comparator.comparing(Task::getCreateTime).thenComparing(Task::getId, Inspector::compareIds));
        return tasks;
    }

    /**
     * The variables {@code match.localVariables} is checked against: the variables visible from the task's execution
     * (its own, those of the enclosing scopes up to the process instance - where the multi-instance element variable
     * lives) overlaid with the task-local variables.
     */
    private Map<String, Object> matchView(Task task) {
        Map<String, Object> view = new LinkedHashMap<>();
        if (task.getExecutionId() != null) {
            view.putAll(engine.runtimeService().getVariables(task.getExecutionId()));
        }
        view.putAll(engine.taskService().getVariablesLocal(task.getId()));
        return view;
    }

    private List<Task> select(List<Task> tasks, Step.TaskMatch match) {
        if (match == null) {
            return tasks;
        }
        Map<String, Object> fields = match.fields();
        List<Task> matching = new ArrayList<>();
        for (Task task : tasks) {
            boolean ok = true;
            if (fields.containsKey("assignee") && !ValueMatcher.match("assignee", fields.get("assignee"), task.getAssignee()).isEmpty()) {
                ok = false;
            }
            if (ok && fields.containsKey("name") && !ValueMatcher.match("name", fields.get("name"), task.getName()).isEmpty()) {
                ok = false;
            }
            if (ok && fields.get("localVariables") instanceof Map<?, ?> expected
                    && !ValueMatcher.matchMap("localVariables", castMap(expected), matchView(task), true).isEmpty()) {
                ok = false;
            }
            if (ok) {
                matching.add(task);
            }
        }
        if (fields.get("index") instanceof Number n) {
            int position = n.intValue();
            return position <= matching.size() ? List.of(matching.get(position - 1)) : List.of();
        }
        return matching;
    }

    private Task single(String activity, Step.TaskMatch match) {
        List<Task> all = tasksAt(activity);
        List<Task> chosen = select(all, match);
        if (chosen.isEmpty()) {
            throw new Failure("No open task at activity '" + activity + "'" + (match != null ? " matches " + match.describe() : "")
                    + ". Open tasks at the activity: " + describeTasks(all) + "; all open tasks of the scenario: " + describeTasks(allOpenTasks()));
        }
        if (chosen.size() > 1) {
            throw new Failure(chosen.size() + " open tasks at activity '" + activity + "' " + describeTasks(chosen)
                    + "; narrow it down with \"match\" (localVariables, assignee, name, index)");
        }
        return chosen.get(0);
    }

    private static String describeTasks(List<Task> tasks) {
        return tasks.stream().map(t -> t.getTaskDefinitionKey() + "(id=" + t.getId() + ", assignee=" + t.getAssignee() + ")").toList().toString();
    }

    private void expectTask(Step.ExpectTask s) {
        List<Task> all = tasksAt(s.activity());
        if (s.count() != null && all.size() != s.count()) {
            throw new Failure("Expected " + s.count() + " open task(s) at activity '" + s.activity() + "' but found " + all.size()
                    + " " + describeTasks(all) + "; all open tasks of the scenario: " + describeTasks(allOpenTasks()));
        }
        if (s.count() != null && s.count() == 0) {
            return;
        }
        List<Task> targets = select(all, s.match());
        if (targets.isEmpty()) {
            throw new Failure("No open task at activity '" + s.activity() + "'" + (s.match() != null ? " matches " + s.match().describe() : "")
                    + ". Open tasks at the activity: " + describeTasks(all) + "; all open tasks of the scenario: " + describeTasks(allOpenTasks()));
        }
        if (s.count() == null && targets.size() > 1) {
            throw new Failure(targets.size() + " open tasks at activity '" + s.activity() + "' " + describeTasks(targets)
                    + "; use \"count\" to check all of them or \"match\" to pick one");
        }
        List<String> problems = new ArrayList<>();
        for (Task task : targets) {
            String label = "task '" + s.activity() + "'" + (targets.size() > 1 ? " (id " + task.getId() + ")" : "");
            problems.addAll(checkTask(label, task, s));
        }
        failIfAny(problems);
    }

    private List<String> checkTask(String label, Task task, Step.ExpectTask s) {
        List<String> problems = new ArrayList<>();
        for (Map.Entry<String, Object> field : s.fields().entrySet()) {
            Object expected = field.getValue();
            String path = label + "." + field.getKey();
            switch (field.getKey()) {
                case "name" -> problems.addAll(ValueMatcher.match(path, expected, task.getName()));
                case "description" -> problems.addAll(ValueMatcher.match(path, expected, task.getDescription()));
                case "assignee" -> problems.addAll(ValueMatcher.match(path, expected, task.getAssignee()));
                case "owner" -> problems.addAll(ValueMatcher.match(path, expected, task.getOwner()));
                case "priority" -> problems.addAll(ValueMatcher.match(path, expected, task.getPriority()));
                case "category" -> problems.addAll(ValueMatcher.match(path, expected, task.getCategory()));
                case "formKey" -> problems.addAll(ValueMatcher.match(path, expected, task.getFormKey()));
                case "dueDate" -> problems.addAll(ValueMatcher.match(path, expected, task.getDueDate()));
                case "candidateUsers" -> problems.addAll(checkSet(path, castList(expected), candidates(task, true)));
                case "candidateGroups" -> problems.addAll(checkSet(path, castList(expected), candidates(task, false)));
                case "localVariables" -> problems.addAll(ValueMatcher.matchMap(path, castMap(expected),
                        engine.taskService().getVariablesLocal(task.getId()), s.partial()));
                case "identityLinks" -> problems.addAll(checkIdentityLinks(path, expected, task));
                default -> throw new IllegalStateException("unknown expectTask field " + field.getKey());
            }
        }
        for (String user : s.visibleTo()) {
            if (!visibleTo(user, task)) {
                problems.add(label + ".visibleTo: '" + user + "' cannot see the task through TaskRuntime (assignee "
                        + task.getAssignee() + ", candidate users " + candidates(task, true) + ", candidate groups " + candidates(task, false) + ")");
            }
        }
        for (String user : s.notVisibleTo()) {
            if (visibleTo(user, task)) {
                problems.add(label + ".notVisibleTo: '" + user + "' can see the task through TaskRuntime but must not");
            }
        }
        return problems;
    }

    private List<String> checkIdentityLinks(String path, Object expected, Task task) {
        List<IdentityLink> links = engine.taskService().getIdentityLinksForTask(task.getId());
        List<String> problems = new ArrayList<>();
        for (Object entry : castList(expected)) {
            Map<String, Object> wanted = castMap(entry);
            String type = String.valueOf(wanted.get("type"));
            boolean user = wanted.containsKey("user");
            String id = String.valueOf(user ? wanted.get("user") : wanted.get("group"));
            boolean found = links.stream().anyMatch(l -> type.equals(l.getType()) && id.equals(user ? l.getUserId() : l.getGroupId()));
            if (!found) {
                problems.add(path + ": expected an identity link of type '" + type + "' for " + (user ? "user" : "group") + " '" + id
                        + "' but the task has " + links.stream().map(l -> l.getType() + ":" + (l.getUserId() != null ? "user " + l.getUserId() : "group " + l.getGroupId())).toList());
            }
        }
        return problems;
    }

    private Set<String> candidates(Task task, boolean users) {
        Set<String> out = new TreeSet<>();
        for (IdentityLink link : engine.taskService().getIdentityLinksForTask(task.getId())) {
            if (IdentityLinkType.CANDIDATE.equals(link.getType())) {
                String id = users ? link.getUserId() : link.getGroupId();
                if (id != null) {
                    out.add(id);
                }
            }
        }
        return out;
    }

    private boolean visibleTo(String user, Task task) {
        return identity.runAs(user, () -> engine.taskRuntime().tasks(Pageable.of(0, 10_000),
                        TaskPayloadBuilder.tasks().withProcessInstanceId(task.getProcessInstanceId()).build())
                .getContent().stream().anyMatch(t -> task.getId().equals(t.getId())));
    }

    private static List<String> checkSet(String path, List<String> expected, Set<String> actual) {
        Set<String> want = new TreeSet<>(expected);
        return want.equals(actual) ? List.of() : List.of(path + ": expected exactly " + want + " but was " + actual);
    }

    private void completeTask(Step.CompleteTask s) {
        Task task = single(s.activity(), s.match());
        expectFailure(s.expectFailure(), "completeTask '" + s.activity() + "'", () -> identity.runAs(s.user(), () -> {
            if (!s.user().equals(task.getAssignee())) {
                engine.taskRuntime().claim(TaskPayloadBuilder.claim().withTaskId(task.getId()).build());
            }
            engine.taskRuntime().complete(TaskPayloadBuilder.complete().withTaskId(task.getId()).withVariables(s.variables()).build());
        }));
    }

    // ---- connectors, children, receive tasks, active activities --------------------------------------------------------

    private void expectConnectorCall(Step.ExpectConnectorCall s) {
        List<ConnectorCall> calls = engine.connectorCalls().callsOf(tree.instanceIds()).stream()
                .filter(c -> s.activity().equals(c.activityId())).toList();
        String described = calls.isEmpty() ? "none" : calls.stream().map(ConnectorCall::toString).toList().toString();
        if (s.count() != null && calls.size() != s.count()) {
            throw new Failure("Expected " + s.count() + " call(s) at activity '" + s.activity() + "' but " + calls.size() + " were recorded: " + described);
        }
        if (s.count() != null && s.count() == 0) {
            return;
        }
        int position = s.call() != null ? s.call() : 1;
        if (calls.size() < position) {
            throw new Failure("Expected at least " + position + " call(s) of a connector at activity '" + s.activity() + "' but "
                    + calls.size() + " were recorded. Connector calls of the scenario: "
                    + engine.connectorCalls().callsOf(tree.instanceIds()).stream().map(ConnectorCall::toString).toList());
        }
        ConnectorCall call = calls.get(position - 1);
        String label = "connector call " + position + " at '" + s.activity() + "'";
        List<String> problems = new ArrayList<>();
        if (s.connector() != null && !s.connector().equals(call.connector())) {
            problems.add(label + ".connector: expected " + ValueMatcher.show(s.connector()) + " but was " + ValueMatcher.show(call.connector()));
        }
        if (s.inbound() != null) {
            problems.addAll(ValueMatcher.matchMap(label + ".inbound", s.inbound(), call.inbound(), s.partial()));
        }
        if (s.outbound() != null) {
            problems.addAll(ValueMatcher.matchMap(label + ".outbound", s.outbound(), call.outbound(), s.partial()));
        }
        failIfAny(problems);
    }

    private List<String> childInstanceIds(String callActivity) {
        List<HistoricActivityInstance> calls = new ArrayList<>();
        for (String id : tree.instanceIds()) {
            for (HistoricActivityInstance a : inspect.activities(id)) {
                if (callActivity.equals(a.getActivityId()) && a.getCalledProcessInstanceId() != null) {
                    calls.add(a);
                }
            }
        }
        return calls.stream().map(HistoricActivityInstance::getCalledProcessInstanceId).distinct()
                .sorted(Inspector::compareIds).toList();
    }

    private void expectChildInstance(Step.ExpectChildInstance s) {
        List<String> children = childInstanceIds(s.callActivity());
        if (s.count() != null && children.size() != s.count()) {
            throw new Failure("Expected call activity '" + s.callActivity() + "' to have started " + s.count() + " child instance(s) but it started "
                    + children.size() + " " + children);
        }
        int position = s.call() != null ? s.call() : 1;
        if (children.size() < position) {
            throw new Failure("Expected call activity '" + s.callActivity() + "' to have started at least " + position
                    + " child instance(s) but it started " + children.size() + ". Was the call activity reached? Path of the root: " + inspect.path(rootId));
        }
        String childId = children.get(position - 1);
        HistoricProcessInstance child = inspect.historic(childId);
        String label = "child instance " + position + " of '" + s.callActivity() + "'";
        List<String> problems = new ArrayList<>();
        if (s.process() != null && !s.process().equals(child.getProcessDefinitionKey())) {
            problems.add(label + ".process: expected '" + s.process() + "' but was '" + child.getProcessDefinitionKey() + "'");
        }
        if (s.hasBusinessKey()) {
            problems.addAll(ValueMatcher.match(label + ".businessKey", s.businessKey(), child.getBusinessKey()));
        }
        if (s.state() != null) {
            String actual = child.getEndTime() != null ? "COMPLETED" : "ACTIVE";
            if (!s.state().equals(actual)) {
                problems.add(label + ".state: expected " + s.state() + " but was " + actual);
            }
        }
        if (s.startVariables() != null) {
            problems.addAll(ValueMatcher.matchMap(label + ".startVariables", s.startVariables(), inspect.startVariables(childId), true));
        }
        if (s.variables() != null) {
            problems.addAll(ValueMatcher.matchMap(label + ".variables", s.variables(), inspect.processVariables(childId), true));
        }
        if (s.absentVariables() != null) {
            Map<String, Object> variables = inspect.processVariables(childId);
            s.absentVariables().stream().filter(variables::containsKey).forEach(name ->
                    problems.add(label + ".absentVariables: variable '" + name + "' exists with value " + ValueMatcher.show(variables.get(name))));
        }
        if (s.path() != null) {
            problems.addAll(inspect.checkPath(label, childId, s.path()));
        }
        failIfAny(problems);
    }

    private void expectTimer(Step.ExpectTimer s) {
        List<Job> timers = jobSupport.at(jobSupport.timerJobs(tree), s.activity());
        String described = timers.stream().map(j -> j.getId() + " due " + (j.getDuedate() == null ? null : j.getDuedate().toInstant())).toList().toString();
        if (s.count() != null && timers.size() != s.count()) {
            throw new Failure("Expected " + s.count() + " timer job(s) at activity '" + s.activity() + "' but found " + timers.size() + " " + described
                    + "; all timer jobs of the scenario: " + jobSupport.describe(jobSupport.timerJobs(tree)));
        }
        if (s.count() == null && timers.isEmpty()) {
            throw new Failure("No timer job at activity '" + s.activity() + "'; all timer jobs of the scenario: " + jobSupport.describe(jobSupport.timerJobs(tree)));
        }
        if (s.hasDueDate() && !timers.isEmpty()) {
            failIfAny(ValueMatcher.match("timer '" + s.activity() + "'.dueDate", s.dueDate(), timers.get(0).getDuedate()));
        }
    }

    private void triggerReceiveTask(Step.TriggerReceiveTask s) {
        List<Execution> waiting = new ArrayList<>();
        for (String id : tree.instanceIds()) {
            waiting.addAll(engine.runtimeService().createExecutionQuery().processInstanceId(id).activityId(s.activity()).list());
        }
        if (waiting.isEmpty()) {
            throw new Failure("No execution is waiting at activity '" + s.activity() + "'. Active activities: " + activeActivities());
        }
        List<Execution> chosen = waiting;
        if (s.match() != null && s.match().fields().get("localVariables") instanceof Map<?, ?> expected) {
            chosen = waiting.stream().filter(e -> ValueMatcher.matchMap("localVariables", castMap(expected),
                    engine.runtimeService().getVariables(e.getId()), true).isEmpty()).toList();
            if (chosen.isEmpty()) {
                throw new Failure("None of the " + waiting.size() + " executions waiting at activity '" + s.activity() + "' matches "
                        + s.match().describe());
            }
        }
        if (chosen.size() > 1) {
            throw new Failure(chosen.size() + " executions are waiting at activity '" + s.activity()
                    + "'; triggerReceiveTask needs exactly one: narrow it down with \"match\" (localVariables)");
        }
        if (s.variables().isEmpty()) {
            engine.runtimeService().trigger(chosen.get(0).getId());
        } else {
            engine.runtimeService().trigger(chosen.get(0).getId(), new HashMap<>(s.variables()));
        }
    }

    private Set<String> activeActivities() {
        Set<String> active = new TreeSet<>();
        for (String id : tree.instanceIds()) {
            if (inspect.isRunning(id)) {
                active.addAll(engine.runtimeService().getActiveActivityIds(id));
            }
        }
        return active;
    }

    private void expectActive(Step.ExpectActive s) {
        Set<String> active = activeActivities();
        List<String> problems = new ArrayList<>();
        if (s.exactly() != null && !new TreeSet<>(s.exactly()).equals(active)) {
            problems.add("expected exactly the active activities " + new TreeSet<>(s.exactly()) + " but they are " + active);
        }
        if (s.contains() != null) {
            s.contains().stream().filter(id -> !active.contains(id))
                    .forEach(id -> problems.add("activity '" + id + "' is not active; active activities: " + active));
        }
        if (s.notContains() != null) {
            s.notContains().stream().filter(active::contains)
                    .forEach(id -> problems.add("activity '" + id + "' is active but must not be; active activities: " + active));
        }
        failIfAny(problems);
    }

    // ---- final expectations ---------------------------------------------------------------------------------------------

    private void checkExpect(Expect e) {
        List<String> problems = new ArrayList<>();
        boolean running = inspect.isRunning(rootId);
        List<Job> deadLetters = jobSupport.deadLetterJobs(tree);
        if (e.state() != null) {
            String actual = !running ? "COMPLETED" : deadLetters.isEmpty() ? "ACTIVE" : "DEADLETTER";
            boolean ok = switch (e.state()) {
                case "COMPLETED" -> !running;
                case "ACTIVE" -> running && deadLetters.isEmpty();
                case "DEADLETTER" -> !deadLetters.isEmpty();
                default -> false;
            };
            if (!ok) {
                problems.add("state: expected " + e.state() + " but was " + actual
                        + (running ? "; active activities: " + activeActivities() : "")
                        + (deadLetters.isEmpty() ? "" : "; dead-letter jobs: " + jobSupport.describe(deadLetters)));
            }
        }
        if (e.endEvents() != null) {
            Set<String> expected = new TreeSet<>(e.endEvents());
            Set<String> actual = inspect.endEvents(rootId);
            if (!expected.equals(actual)) {
                problems.add("endEvents: expected exactly " + expected + " but the instance reached " + actual + "; path: " + inspect.path(rootId));
            }
        }
        if (e.path() != null) {
            problems.addAll(inspect.checkPath("root", rootId, e.path()));
        }
        if (e.variables() != null || e.absentVariables() != null) {
            Map<String, Object> variables = inspect.processVariables(rootId);
            if (e.variables() != null) {
                problems.addAll(ValueMatcher.matchMap("variables", e.variables(), variables, true));
            }
            if (e.absentVariables() != null) {
                e.absentVariables().stream().filter(variables::containsKey).forEach(name ->
                        problems.add("absentVariables: variable '" + name + "' exists with value " + ValueMatcher.show(variables.get(name))));
            }
        }
        if (e.deadLetterJobs() != null) {
            problems.addAll(checkDeadLetters(e.deadLetterJobs(), deadLetters));
        }
        failures.addAll(problems);
    }

    private List<String> checkDeadLetters(List<DeadLetterExpectation> expected, List<Job> actual) {
        List<String> problems = new ArrayList<>();
        List<Job> unmatched = new ArrayList<>(actual);
        for (DeadLetterExpectation want : expected) {
            Job found = null;
            for (Job job : unmatched) {
                boolean activityOk = want.activity().equals(jobSupport.activityOf(job));
                boolean messageOk = want.exceptionMessageContains() == null
                        || (job.getExceptionMessage() != null && job.getExceptionMessage().contains(want.exceptionMessageContains()));
                if (activityOk && messageOk) {
                    found = job;
                    break;
                }
            }
            if (found == null) {
                problems.add("deadLetterJobs: no dead-letter job at activity '" + want.activity() + "'"
                        + (want.exceptionMessageContains() != null ? " with exception message containing \"" + want.exceptionMessageContains() + "\"" : "")
                        + "; dead-letter jobs are " + describeDeadLetters(actual));
            } else {
                unmatched.remove(found);
            }
        }
        if (!unmatched.isEmpty()) {
            problems.add("deadLetterJobs: unexpected dead-letter job(s) " + describeDeadLetters(unmatched));
        }
        return problems;
    }

    private String describeDeadLetters(List<Job> jobs) {
        return jobs.stream().map(j -> jobSupport.activityOf(j) + " [" + j.getExceptionMessage() + "]").toList().toString();
    }

    // ---- visited, cleanup -----------------------------------------------------------------------------------------------

    private VisitedElements collectVisited(VisitedElements visited) {
        if (tree == null) {
            return visited;
        }
        try {
            inspect.visits(tree.instanceIds()).forEach((key, v) -> visited.add(key, v.nodes, v.flows));
        } catch (RuntimeException e) {
            failures.add("Could not collect the visited elements: " + describe(e));
            cause = cause == null ? e : cause;
        }
        return visited;
    }

    /** Deletes every instance this scenario left active, clears recorders, clock and identity. */
    private void cleanup() {
        Set<String> treeIds = new LinkedHashSet<>();
        try {
            if (tree != null) {
                treeIds.addAll(tree.instanceIds());
            }
            deleteLeftovers();
            jobSupport.deleteOrphanedEventJobs();
        } catch (RuntimeException e) {
            failures.add("Cleanup failed: " + describe(e));
            cause = cause == null ? e : cause;
        } finally {
            engine.connectorCalls().clear(treeIds);
            engine.sequenceFlows().clear(treeIds);
            engine.configuration().getClock().reset();
            Identity.clear();
        }
    }

    /** How long the cleanup keeps trying while the async executor is still changing an instance: the default executor timeout. */
    private static final long CLEANUP_TIMEOUT_MS = 10_000;

    private void deleteLeftovers() {
        long deadline = System.nanoTime() + CLEANUP_TIMEOUT_MS * 1_000_000L;
        while (true) {
            List<org.activiti.engine.runtime.ProcessInstance> leftovers = engine.runtimeService().createProcessInstanceQuery().list().stream()
                    .filter(i -> !knownBefore.contains(i.getId())).toList();
            if (leftovers.isEmpty()) {
                return;
            }
            if (System.nanoTime() > deadline) {
                throw new IllegalStateException(leftovers.size() + " process instance(s) created by the scenario could not be deleted");
            }
            boolean busy = false;
            for (org.activiti.engine.runtime.ProcessInstance instance : leftovers) {
                if (instance.getSuperExecutionId() == null
                        && engine.runtimeService().createProcessInstanceQuery().processInstanceId(instance.getId()).count() > 0) {
                    try {
                        engine.runtimeService().deleteProcessInstance(instance.getId(), "scenario cleanup");
                    } catch (org.activiti.engine.ActivitiObjectNotFoundException gone) {
                        // With the async executor on the instance may end between the query and the delete: it is gone, which is the goal.
                    } catch (org.activiti.engine.ActivitiOptimisticLockingException changing) {
                        // The executor changed it at the same moment; the next pass looks again (the instance may be gone by then).
                        busy = true;
                    }
                }
            }
            if (busy) {
                pauseBetweenPasses();
            }
        }
    }

    private static void pauseBetweenPasses() {
        try {
            Thread.sleep(50);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    // ---- helpers ----------------------------------------------------------------------------------------------------------

    private void expectFailure(Step.ExpectedFailure expected, String what, Runnable action) {
        if (expected == null) {
            action.run();
            return;
        }
        try {
            action.run();
        } catch (RuntimeException e) {
            List<String> problems = failureMismatches(expected, e);
            if (!problems.isEmpty()) {
                throw new Failure(what + " failed, but not as expected: " + String.join("; ", problems) + ". Actual failure: " + describe(e));
            }
            return;
        }
        throw new Failure(what + " was expected to fail (" + expected.describe() + ") but succeeded");
    }

    private static List<String> failureMismatches(Step.ExpectedFailure expected, Throwable t) {
        List<String> problems = new ArrayList<>();
        List<Throwable> chain = new ArrayList<>();
        for (Throwable c = t; c != null && !chain.contains(c); c = c.getCause()) {
            chain.add(c);
        }
        if (expected.exception() != null && chain.stream().noneMatch(c ->
                c.getClass().getSimpleName().equals(expected.exception()) || c.getClass().getName().equals(expected.exception()))) {
            problems.add("no exception of type " + expected.exception() + " in the cause chain");
        }
        if (expected.messageContains() != null && chain.stream().noneMatch(c ->
                c.getMessage() != null && c.getMessage().contains(expected.messageContains()))) {
            problems.add("no message contains \"" + expected.messageContains() + "\"");
        }
        return problems;
    }

    private static void failIfAny(List<String> problems) {
        if (!problems.isEmpty()) {
            throw new Failure(String.join("\n", problems));
        }
    }

    /** Class and message of an exception and its causes, for reports. */
    static String describe(Throwable t) {
        StringBuilder sb = new StringBuilder();
        List<Throwable> seen = new ArrayList<>();
        for (Throwable c = t; c != null && !seen.contains(c) && seen.size() < 5; c = c.getCause()) {
            seen.add(c);
            sb.append(seen.size() == 1 ? "" : "\n  caused by ").append(c.getClass().getSimpleName());
            if (c.getMessage() != null) {
                sb.append(": ").append(c.getMessage());
            }
        }
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object o) {
        return (Map<String, Object>) o;
    }

    @SuppressWarnings("unchecked")
    private static List<String> castList(Object o) {
        return (List<String>) o;
    }
}
