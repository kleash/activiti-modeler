package io.github.kleash.activiti.rest.core;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

import com.fasterxml.jackson.databind.JsonNode;

/** Start as the principal, observe the path, work on tasks as the principal. */
class InstancesAndTasksApiTest extends AbstractApiTest {

    @Test
    void anInstanceIsStartedAsThePrincipalAndShowsItsStateTasksAndPath() throws Exception {
        JsonNode started = post("alice", "/process-instances",
                Map.of("processKey", "restReview", "businessKey", "B-1", "name", "first review", "variables", Map.of("amount", 5000)), 201);
        String id = started.path("id").asText();

        assertThat(started.path("state").asText()).isEqualTo("ACTIVE");
        assertThat(started.path("processDefinitionKey").asText()).isEqualTo("restReview");
        assertThat(started.path("businessKey").asText()).isEqualTo("B-1");
        assertThat(started.path("name").asText()).isEqualTo("first review");
        assertThat(started.path("startUserId").asText()).isEqualTo("alice");
        assertThat(strings(started.path("activeActivityIds"))).containsExactly("review");

        // the initiator variable is the principal, set by the authentication bridge
        Map<String, JsonNode> variables = variablesOf(started);
        assertThat(variables.get("startedBy").path("value").asText()).isEqualTo("alice");
        assertThat(variables.get("amount").path("value").asInt()).isEqualTo(5000);
        assertThat(variables.get("amount").path("type").asText()).isEqualTo("integer");

        JsonNode task = started.path("tasks").get(0);
        assertThat(task.path("taskDefinitionKey").asText()).isEqualTo("review");
        assertThat(task.path("name").asText()).isEqualTo("Review the request");
        assertThat(task.path("formKey").asText()).isEqualTo("reviewForm");
        assertThat(task.path("priority").asInt()).isEqualTo(7);
        assertThat(absent(task.path("assignee"))).isTrue();
        assertThat(strings(task.path("candidateGroups"))).containsExactly("clerks");
        assertThat(task.path("localVariables").path("amount").asInt()).isEqualTo(5000);

        JsonNode path = started.path("path");
        assertThat(path.path("sequenceFlowsSource").asText()).isEqualTo("recorded");
        assertThat(ids(path.path("sequenceFlows"), "id")).containsExactly("f_start_review");
        assertThat(ids(path.path("activities"), "activityId")).containsExactly("start", "review");
        JsonNode review = path.path("activities").get(1);
        assertThat(review.path("activityType").asText()).isEqualTo("userTask");
        assertThat(absent(review.path("endTime"))).isTrue();
        assertThat(review.path("taskId").asText()).isEqualTo(task.path("id").asText());

        // lists
        JsonNode list = get("alice", "/process-instances?definitionKey=restReview&state=active&businessKey=B-1");
        assertThat(list.path("total").asLong()).isEqualTo(1);
        assertThat(list.path("items").get(0).path("id").asText()).isEqualTo(id);
        assertThat(list.path("items").get(0).path("state").asText()).isEqualTo("ACTIVE");
        assertThat(get("alice", "/process-instances?state=running&businessKey=B-1").path("total").asLong()).isEqualTo(1);
        assertThat(get("alice", "/process-instances?state=completed&businessKey=B-1").path("total").asLong()).isZero();
        assertThat(get("alice", "/process-instances?startedBy=alice&businessKey=B-1").path("total").asLong()).isEqualTo(1);
        assertThat(get("alice", "/process-instances?startedBy=bob&businessKey=B-1").path("total").asLong()).isZero();
        problem(perform("alice", HttpMethod.GET, "/process-instances?state=weird", null), 400);
    }

    @Test
    void theActingUserIsNeverTakenFromTheBody() throws Exception {
        JsonNode refused = problem(perform("alice", HttpMethod.POST, "/process-instances",
                "{\"processKey\":\"restReview\",\"user\":\"bob\"}"), 400);
        assertThat(refused.path("detail").asText()).containsIgnoringCase("user");
        assertThat(refused.path("engineException").asText()).contains("HttpMessageNotReadableException");
        problem(perform("alice", HttpMethod.POST, "/tasks/anything/complete", "{\"user\":\"bob\",\"variables\":{}}"), 400);
        problem(perform("alice", HttpMethod.POST, "/process-instances", "{\"processKey\":"), 400);
        problem(perform("alice", HttpMethod.POST, "/process-instances", Map.of("processKey", "restReview", "messageName", "x")), 400);
        problem(perform("alice", HttpMethod.POST, "/process-instances", Map.of()), 400);
    }

    @Test
    void completingTheTaskAsTheClaimerRunsTheProcessAndTheEndedInstanceKeepsItsData() throws Exception {
        String id = start("alice", "restReview", Map.of("amount", 120));
        String taskId = taskOf(id);

        JsonNode claimed = post("alice", "/tasks/" + taskId + "/claim", null, 200);
        assertThat(claimed.path("assignee").asText()).isEqualTo("alice");
        // already claimed: the runtime refuses, 409 problem
        JsonNode again = problem(perform("alice", HttpMethod.POST, "/tasks/" + taskId + "/claim", null), 409);
        assertThat(again.path("detail").asText()).contains("already claimed");
        // bob is not a candidate: the runtime answers "not found", 404
        problem(perform("bob", HttpMethod.POST, "/tasks/" + taskId + "/complete", Map.of("variables", Map.of("approved", true))), 404);

        post("alice", "/tasks/" + taskId + "/complete", Map.of("variables", Map.of("approved", true)), 204);

        JsonNode ended = get("alice", "/process-instances/" + id);
        assertThat(ended.path("state").asText()).isEqualTo("COMPLETED");
        assertThat(absent(ended.path("endTime"))).isFalse();
        assertThat(absent(ended.path("durationMillis"))).isFalse();
        assertThat(ended.path("endActivityId").asText()).isEqualTo("approvedEnd");
        assertThat(ended.path("activeActivityIds")).isEmpty();
        assertThat(ended.path("tasks")).isEmpty();
        assertThat(ids(ended.path("path").path("activities"), "activityId")).containsExactly("start", "review", "decide", "approvedEnd");
        assertThat(ids(ended.path("path").path("sequenceFlows"), "id")).containsExactly("f_start_review", "f_review_decide", "f_decide_approved");
        JsonNode first = ended.path("path").path("sequenceFlows").get(0);
        assertThat(first.path("sourceActivityId").asText()).isEqualTo("start");
        assertThat(first.path("targetActivityId").asText()).isEqualTo("review");
        assertThat(first.path("order").asLong()).isPositive();

        // variables of the ended instance come from history; the completion variable reached the process through the output mapping
        Map<String, JsonNode> variables = variablesOf(ended);
        assertThat(variables.get("approved").path("value").asBoolean()).isTrue();
        assertThat(variables.get("amount").path("value").asInt()).isEqualTo(120);
        assertThat(variables.get("startedBy").path("value").asText()).isEqualTo("alice");
        assertThat(get("alice", "/process-instances/" + id + "/variables")).hasSize(variables.size());

        JsonNode history = get("alice", "/process-instances/" + id + "/variables/history");
        assertThat(history).anyMatch(u -> u.path("name").asText().equals("approved") && u.path("value").asBoolean());

        assertThat(listed("/process-instances?state=completed&definitionKey=restReview")).contains(id);
        assertThat(listed("/process-instances?state=running&definitionKey=restReview")).doesNotContain(id);
        assertThat(get("alice", "/process-instances/" + id + "/path").path("activities")).hasSize(4);
    }

    @Test
    void theRejectedBranchIsTakenWhenTheTaskSaysSo() throws Exception {
        String id = start("alice", "restReview", Map.of("amount", 1));
        String taskId = taskOf(id);
        post("alice", "/tasks/" + taskId + "/claim", null, 200);
        post("alice", "/tasks/" + taskId + "/complete", Map.of("variables", Map.of("approved", false)), 204);

        JsonNode ended = get("alice", "/process-instances/" + id);
        assertThat(ended.path("endActivityId").asText()).isEqualTo("rejectedEnd");
        assertThat(ids(ended.path("path").path("sequenceFlows"), "id")).contains("f_decide_rejected").doesNotContain("f_decide_approved");
    }

    @Test
    void myTasksAreTheOnesTaskRuntimeShowsAndAllTasksAreForReaders() throws Exception {
        String id = start("alice", "restReview", Map.of());

        assertThat(get("alice", "/tasks?mine=true&processInstanceId=" + id).path("total").asLong()).isEqualTo(1);
        assertThat(get("bob", "/tasks?mine=true&processInstanceId=" + id).path("total").asLong()).isZero();
        // a reader without the clerks group still sees it in the full list, as an operator does
        assertThat(get("bob", "/tasks?processInstanceId=" + id).path("total").asLong()).isEqualTo(1);
        assertThat(get("alice", "/tasks?candidateGroup=clerks&processInstanceId=" + id + "&candidates=true&variables=true").path("items").get(0)
                .path("candidateGroups").get(0).asText()).isEqualTo("clerks");
        assertThat(get("alice", "/tasks?unassigned=true&processInstanceId=" + id).path("total").asLong()).isEqualTo(1);
        assertThat(get("alice", "/tasks?assignee=alice&processInstanceId=" + id).path("total").asLong()).isZero();
        assertThat(get("alice", "/tasks?nameLike=Review&processInstanceId=" + id).path("total").asLong()).isEqualTo(1);
        assertThat(get("alice", "/tasks/" + taskOf(id)).path("taskDefinitionKey").asText()).isEqualTo("review");
        problem(perform("alice", HttpMethod.GET, "/tasks/does-not-exist", null), 404);
    }

    @Test
    void aClaimedTaskCanBeReleasedAndAssignedToACandidateUser() throws Exception {
        String id = start("alice", "restAssign", Map.of());
        String taskId = taskOf(id);

        post("alice", "/tasks/" + taskId + "/claim", null, 200);
        assertThat(absent(post("alice", "/tasks/" + taskId + "/release", null, 200).path("assignee"))).isTrue();
        post("alice", "/tasks/" + taskId + "/claim", null, 200);

        // the assignee hands it to the other candidate user (TaskRuntime) ...
        assertThat(post("alice", "/tasks/" + taskId + "/assign", Map.of("assignee", "bob"), 200).path("assignee").asText()).isEqualTo("bob");
        // ... alice no longer holds it: she cannot release it
        problem(perform("alice", HttpMethod.POST, "/tasks/" + taskId + "/release", null), 404);
        // ... and an admin may reassign any task (TaskAdminRuntime)
        assertThat(post("admin", "/tasks/" + taskId + "/assign", Map.of("assignee", "alice"), 200).path("assignee").asText()).isEqualTo("alice");
        problem(perform("alice", HttpMethod.POST, "/tasks/" + taskId + "/assign", Map.of()), 400);
        // somebody who is not a candidate user cannot be assigned
        problem(perform("alice", HttpMethod.POST, "/tasks/" + taskId + "/assign", Map.of("assignee", "admin")), 409);
    }

    @Test
    void theInstanceCanBeSuspendedActivatedCancelledAndItsVariablesEdited() throws Exception {
        String id = start("alice", "restReview", Map.of("amount", 10));

        post("alice", "/process-instances/" + id + "/suspend", null, 204);
        assertThat(get("alice", "/process-instances/" + id).path("state").asText()).isEqualTo("SUSPENDED");
        assertThat(listed("/process-instances?state=suspended&definitionKey=restReview")).containsExactly(id);
        JsonNode running = get("alice", "/process-instances?state=running&definitionKey=restReview");
        assertThat(running.path("items")).anyMatch(i -> i.path("id").asText().equals(id) && i.path("state").asText().equals("SUSPENDED"));
        problem(perform("alice", HttpMethod.POST, "/process-instances/" + id + "/suspend", null), 422);
        post("alice", "/process-instances/" + id + "/activate", null, 204);
        assertThat(get("alice", "/process-instances/" + id).path("state").asText()).isEqualTo("ACTIVE");

        send("alice", HttpMethod.PUT, "/process-instances/" + id + "/variables", Map.of("variables", Map.of("amount", 99, "note", "edited")), 204);
        Map<String, JsonNode> variables = variablesOf(get("alice", "/process-instances/" + id));
        assertThat(variables.get("amount").path("value").asInt()).isEqualTo(99);
        assertThat(variables.get("note").path("value").asText()).isEqualTo("edited");
        // a declared property is validated by its type, as the runtime does for any caller
        JsonNode badType = problem(perform("alice", HttpMethod.PUT, "/process-instances/" + id + "/variables",
                Map.of("variables", Map.of("amount", "not a number"))), 400);
        assertThat(badType.path("detail").asText()).contains("amount");
        send("alice", HttpMethod.DELETE, "/process-instances/" + id + "/variables?name=note", null, 204);
        assertThat(variablesOf(get("alice", "/process-instances/" + id))).doesNotContainKey("note");

        send("alice", HttpMethod.DELETE, "/process-instances/" + id + "?reason=not needed", null, 204);
        JsonNode cancelled = get("alice", "/process-instances/" + id);
        assertThat(cancelled.path("state").asText()).isEqualTo("CANCELLED");
        assertThat(cancelled.path("deleteReason").asText()).isEqualTo("not needed");
        assertThat(listed("/process-instances?state=cancelled&definitionKey=restReview")).contains(id);
        // an ended instance cannot be suspended or changed
        problem(perform("alice", HttpMethod.POST, "/process-instances/" + id + "/suspend", null), 409);
        problem(perform("alice", HttpMethod.PUT, "/process-instances/" + id + "/variables", Map.of("variables", Map.of("a", 1))), 409);
        problem(perform("alice", HttpMethod.GET, "/process-instances/unknown", null), 404);
    }

    @Test
    void historyOfAnEndedInstanceCanOnlyBePurgedByAnAdmin() throws Exception {
        String id = start("alice", "restTerminate", Map.of());
        assertThat(absent(get("alice", "/process-instances/" + id).path("endTime"))).isFalse();

        problem(perform("alice", HttpMethod.DELETE, "/process-instances/" + id + "?purgeHistory=true", null), 403);
        send("admin", HttpMethod.DELETE, "/process-instances/" + id + "?purgeHistory=true", null, 204);
        problem(perform("alice", HttpMethod.GET, "/process-instances/" + id, null), 404);
    }

    @Test
    void aTerminateEndEventEndsTheInstanceAndTheStateSaysHow() throws Exception {
        String id = start("alice", "restTerminate", Map.of());
        JsonNode ended = get("alice", "/process-instances/" + id);
        // the engine records a delete reason for a terminate end event
        assertThat(ended.path("endActivityId").asText()).isEqualTo("tEnd");
        assertThat(ended.path("state").asText()).isIn("COMPLETED", "CANCELLED");
    }

    @Test
    void underscoreVariablesAreRefusedAtStartAsTheRuntimeDoes() throws Exception {
        JsonNode refused = problem(perform("alice", HttpMethod.POST, "/process-instances",
                Map.of("processKey", "restReview", "variables", Map.of("_hidden", 1))), 400);
        assertThat(refused.path("detail").asText()).contains("_hidden");
    }

    @Test
    void childInstancesOfACallActivityAreLinkedAndFollowed() throws Exception {
        String parent = start("alice", "restParent", Map.of());
        JsonNode detail = get("alice", "/process-instances/" + parent);

        assertThat(detail.path("children")).hasSize(1);
        JsonNode child = detail.path("children").get(0);
        assertThat(child.path("processDefinitionKey").asText()).isEqualTo("restChild");
        assertThat(child.path("superProcessInstanceId").asText()).isEqualTo(parent);
        assertThat(child.path("state").asText()).isEqualTo("ACTIVE");
        JsonNode call = detail.path("path").path("activities").get(1);
        assertThat(call.path("activityId").asText()).isEqualTo("pCall");
        assertThat(call.path("calledProcessInstanceId").asText()).isEqualTo(child.path("id").asText());
        assertThat(get("alice", "/process-instances?parentId=" + parent).path("items").get(0).path("id").asText()).isEqualTo(child.path("id").asText());

        String childId = child.path("id").asText();
        JsonNode childDetail = get("alice", "/process-instances/" + childId);
        assertThat(childDetail.path("superProcessInstanceId").asText()).isEqualTo(parent);
        String taskId = childDetail.path("tasks").get(0).path("id").asText();
        post("alice", "/tasks/" + taskId + "/claim", null, 200);
        post("alice", "/tasks/" + taskId + "/complete", null, 204);

        assertThat(get("alice", "/process-instances/" + parent).path("state").asText()).isEqualTo("COMPLETED");
        assertThat(get("alice", "/process-instances/" + parent).path("children").get(0).path("state").asText()).isEqualTo("COMPLETED");
        assertThat(get("alice", "/process-instances/" + childId).path("state").asText()).isEqualTo("COMPLETED");
    }

    @Test
    void anInstanceTheRecorderDidNotSeeGetsItsFlowsInferredFromTheModel() throws Exception {
        String id = start("alice", "restReview", Map.of());
        // forget what the recorder saw, as after a restart
        tracker.forget(id);
        JsonNode path = get("alice", "/process-instances/" + id + "/path");
        assertThat(path.path("sequenceFlowsSource").asText()).isEqualTo("inferred");
        assertThat(ids(path.path("sequenceFlows"), "id")).containsExactly("f_start_review");
    }

    @org.springframework.beans.factory.annotation.Autowired
    io.github.kleash.activiti.rest.core.service.SequenceFlowTracker tracker;

    // ---- helpers ----------------------------------------------------------------------------------------------------

    /** Ids on the first 200 items of a list. */
    private List<String> listed(String path) throws Exception {
        return ids(get("alice", path + (path.contains("?") ? "&" : "?") + "size=200").path("items"), "id");
    }

    private String taskOf(String instanceId) throws Exception {
        return get("alice", "/tasks?processInstanceId=" + instanceId).path("items").get(0).path("id").asText();
    }

    private static Map<String, JsonNode> variablesOf(JsonNode detail) {
        Map<String, JsonNode> out = new java.util.LinkedHashMap<>();
        detail.path("variables").forEach(v -> out.put(v.path("name").asText(), v));
        return out;
    }

    private static List<String> ids(JsonNode array, String field) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.path(field).asText()));
        return out;
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }
}
