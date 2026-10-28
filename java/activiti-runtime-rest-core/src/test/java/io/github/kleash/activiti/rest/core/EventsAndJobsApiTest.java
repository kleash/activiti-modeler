package io.github.kleash.activiti.rest.core;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

import io.github.kleash.activiti.rest.core.testapp.FlakyDelegate;

/** Messages, signals, receive tasks, timers, failing jobs and dead letters. */
class EventsAndJobsApiTest extends AbstractApiTest {

    @Test
    void aMessageIsDeliveredToTheSubscriptionWithThatCorrelationKey() throws Exception {
        String one = start("alice", "restMessageCatch", Map.of("orderId", "o-1"));
        String two = start("alice", "restMessageCatch", Map.of("orderId", "o-2"));

        JsonNode delivered = post("alice", "/messages", Map.of("name", "restPaid", "correlationKey", "o-2", "variables", Map.of("paid", 10)), 200);
        assertThat(delivered.path("type").asText()).isEqualTo("message");

        assertThat(get("alice", "/process-instances/" + two).path("state").asText()).isEqualTo("COMPLETED");
        assertThat(get("alice", "/process-instances/" + one).path("state").asText()).isEqualTo("ACTIVE");
        // nothing waits under that key any more
        JsonNode missing = problem(perform("alice", HttpMethod.POST, "/messages", Map.of("name", "restPaid", "correlationKey", "o-2")), 404);
        assertThat(missing.path("detail").asText()).contains("o-2");
        problem(perform("alice", HttpMethod.POST, "/messages", Map.of("correlationKey", "o-1")), 400);
    }

    @Test
    void aSignalReachesEveryWaitingInstance() throws Exception {
        String one = start("alice", "restSignalCatch", Map.of());
        String two = start("bob", "restSignalCatch", Map.of());

        post("alice", "/signals", Map.of("name", "restGo", "variables", Map.of("go", true)), 200);

        for (String id : new String[] {one, two}) {
            JsonNode ended = get("alice", "/process-instances/" + id);
            assertThat(ended.path("state").asText()).isEqualTo("COMPLETED");
            assertThat(ended.path("variables")).anyMatch(v -> v.path("name").asText().equals("go") && v.path("value").asBoolean());
        }
        problem(perform("alice", HttpMethod.POST, "/signals", Map.of()), 400);
    }

    @Test
    void aReceiveTaskIsTriggeredThroughItsExecution() throws Exception {
        String id = start("alice", "restReceive", Map.of());
        JsonNode waiting = get("alice", "/process-instances/" + id).path("executions");
        assertThat(waiting).hasSize(1);
        assertThat(waiting.get(0).path("activityId").asText()).isEqualTo("rcWait");
        assertThat(waiting.get(0).path("activityType").asText()).isEqualTo("receiveTask");
        assertThat(waiting.get(0).path("activityName").asText()).isEqualTo("Wait for the goods");

        post("alice", "/executions/" + waiting.get(0).path("id").asText() + "/trigger", Map.of("variables", Map.of("received", 3)), 200);

        JsonNode ended = get("alice", "/process-instances/" + id);
        assertThat(ended.path("state").asText()).isEqualTo("COMPLETED");
        assertThat(ended.path("variables")).anyMatch(v -> v.path("name").asText().equals("received") && v.path("value").asInt() == 3);
        problem(perform("alice", HttpMethod.POST, "/executions/not-an-execution/trigger", null), 404);
    }

    @Test
    void aTimerIsFiredNowAndTheInstanceMovesOn() throws Exception {
        String id = start("alice", "restTimer", Map.of());
        JsonNode timers = get("alice", "/jobs?kind=TIMER&processInstanceId=" + id);
        assertThat(timers.path("total").asLong()).isEqualTo(1);
        JsonNode timer = timers.path("items").get(0);
        assertThat(timer.path("kind").asText()).isEqualTo("TIMER");
        assertThat(timer.path("activityId").asText()).isEqualTo("tmWait");
        assertThat(absent(timer.path("dueDate"))).isFalse();
        assertThat(get("alice", "/process-instances/" + id).path("jobs")).hasSize(1);

        JsonNode fired = post("alice", "/timers/" + timer.path("id").asText() + "/fire", null, 200);
        assertThat(fired.path("timerJobId").asText()).isEqualTo(timer.path("id").asText());
        assertThat(fired.path("executedBy").asText()).isEqualTo("request");

        assertThat(get("alice", "/process-instances/" + id).path("state").asText()).isEqualTo("COMPLETED");
        problem(perform("alice", HttpMethod.POST, "/timers/" + timer.path("id").asText() + "/fire", null), 404);
        // a timer is not executed as a job
        String second = start("alice", "restTimer", Map.of());
        String timerId = get("alice", "/jobs?kind=TIMER&processInstanceId=" + second).path("items").get(0).path("id").asText();
        JsonNode notExecutable = problem(perform("alice", HttpMethod.POST, "/jobs/" + timerId + "/execute", null), 404);
        assertThat(notExecutable.path("detail").asText()).contains("TIMER").contains("fire");
    }

    @Test
    void aFailingJobEndsAsDeadLetterAndIsRetriedFromThere() throws Exception {
        String id = start("alice", "restFlaky", Map.of());
        JsonNode jobs = get("alice", "/jobs?kind=JOB&processInstanceId=" + id);
        assertThat(jobs.path("total").asLong()).isEqualTo(1);
        String jobId = jobs.path("items").get(0).path("id").asText();
        assertThat(jobs.path("items").get(0).path("activityId").asText()).isEqualTo("fkCall");
        assertThat(jobs.path("items").get(0).path("kind").asText()).isEqualTo("JOB");

        // first attempt: the job fails, the engine turns it into a retry timer with one retry less
        JsonNode failed = problem(perform("alice", HttpMethod.POST, "/jobs/" + jobId + "/execute", null), 422);
        assertThat(failed.path("detail").asText()).contains("flaky call failed");
        JsonNode retryTimers = get("alice", "/jobs?kind=TIMER&processInstanceId=" + id);
        assertThat(retryTimers.path("total").asLong()).isEqualTo(1);
        JsonNode retry = retryTimers.path("items").get(0);
        assertThat(retry.path("exceptionMessage").asText()).contains("flaky call failed");
        assertThat(retry.path("retries").asInt()).isEqualTo(2);
        assertThat(get("alice", "/jobs?withException=true&processInstanceId=" + id).path("total").asLong()).isEqualTo(1);
        JsonNode detail = get("alice", "/jobs/" + retry.path("id").asText());
        assertThat(detail.path("job").path("kind").asText()).isEqualTo("TIMER");
        assertThat(detail.path("stacktrace").asText()).contains("IllegalStateException").contains("FlakyDelegate");

        // set the retries to one and fire the retry timer: the next failure exhausts the retries
        post("alice", "/jobs/" + retry.path("id").asText() + "/retries", Map.of("retries", 1), 204);
        assertThat(get("alice", "/jobs/" + retry.path("id").asText()).path("job").path("retries").asInt()).isEqualTo(1);
        problem(perform("alice", HttpMethod.POST, "/timers/" + retry.path("id").asText() + "/fire", null), 422);
        JsonNode dead = get("alice", "/jobs?kind=DEADLETTER&processInstanceId=" + id);
        assertThat(dead.path("total").asLong()).isEqualTo(1);
        String deadId = dead.path("items").get(0).path("id").asText();
        assertThat(get("alice", "/process-instances/" + id).path("jobs")).anyMatch(j -> j.path("kind").asText().equals("DEADLETTER"));
        assertThat(get("alice", "/jobs/" + deadId).path("stacktrace").asText()).contains("flaky call failed");
        // retries of a dead letter are set by reviving it
        assertThat(problem(perform("alice", HttpMethod.POST, "/jobs/" + deadId + "/retries", Map.of("retries", 3)), 400).path("detail").asText())
                .contains("dead letter");

        // fix the cause, revive and execute
        FlakyDelegate.FAIL.set(false);
        JsonNode revived = post("alice", "/deadletter/" + deadId + "/retry", Map.of("retries", 2, "execute", true), 200);
        assertThat(revived.path("kind").asText()).isEqualTo("JOB");
        assertThat(revived.path("retries").asInt()).isEqualTo(2);

        JsonNode ended = get("alice", "/process-instances/" + id);
        assertThat(ended.path("state").asText()).isEqualTo("COMPLETED");
        assertThat(ended.path("variables")).anyMatch(v -> v.path("name").asText().equals("flakyDone"));
        assertThat(get("alice", "/jobs?processInstanceId=" + id).path("total").asLong()).isZero();
        problem(perform("alice", HttpMethod.GET, "/jobs/" + deadId, null), 404);
    }

    @Test
    void anExecutableJobCanBeExecutedThroughTheApi() throws Exception {
        FlakyDelegate.FAIL.set(false);
        String id = start("alice", "restFlaky", Map.of());
        String jobId = get("alice", "/jobs?kind=JOB&processInstanceId=" + id).path("items").get(0).path("id").asText();
        post("alice", "/jobs/" + jobId + "/execute", null, 204);
        assertThat(get("alice", "/process-instances/" + id).path("state").asText()).isEqualTo("COMPLETED");
        problem(perform("alice", HttpMethod.POST, "/jobs/" + jobId + "/execute", null), 404);
        problem(perform("alice", HttpMethod.POST, "/jobs/" + jobId + "/retries", Map.of("retries", 1)), 404);
        problem(perform("alice", HttpMethod.POST, "/jobs/x/retries", Map.of()), 400);
    }

    @Test
    void anInstanceCanBeStartedByMessage() throws Exception {
        JsonNode started = post("alice", "/process-instances",
                Map.of("messageName", "restOrderPlaced", "businessKey", "M-1", "variables", Map.of("orderId", "o-9")), 201);
        assertThat(started.path("processDefinitionKey").asText()).isEqualTo("restMessageStart");
        assertThat(started.path("businessKey").asText()).isEqualTo("M-1");
        assertThat(started.path("startUserId").asText()).isEqualTo("alice");
        assertThat(started.path("variables")).anyMatch(v -> v.path("name").asText().equals("orderId"));
        assertThat(started.path("tasks").get(0).path("taskDefinitionKey").asText()).isEqualTo("msTask");
    }

    @Test
    void aMessageNameWithoutStartEventIsRefusedWithItsName() throws Exception {
        JsonNode refused = problem(perform("alice", HttpMethod.POST, "/process-instances", Map.of("messageName", "restNoSuchMessage")), 404);
        assertThat(refused.path("detail").asText()).contains("restNoSuchMessage");
    }
}
