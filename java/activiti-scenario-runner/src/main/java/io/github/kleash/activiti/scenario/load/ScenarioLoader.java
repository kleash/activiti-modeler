package io.github.kleash.activiti.scenario.load;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;

import io.github.kleash.activiti.scenario.model.CoverageExemptions;
import io.github.kleash.activiti.scenario.model.DeadLetterExpectation;
import io.github.kleash.activiti.scenario.model.DecisionCase;
import io.github.kleash.activiti.scenario.model.Expect;
import io.github.kleash.activiti.scenario.model.ModelExpectations;
import io.github.kleash.activiti.scenario.model.PathExpectation;
import io.github.kleash.activiti.scenario.model.Scenario;
import io.github.kleash.activiti.scenario.model.ScenarioFile;
import io.github.kleash.activiti.scenario.model.Start;
import io.github.kleash.activiti.scenario.model.Step;

/**
 * Reads scenario files, {@code model-expect.json} and {@code coverage-exemptions.json}. Every document is first
 * validated against its JSON Schema, so that mistakes are reported with the JSON path of the offending value; only
 * then is it mapped onto the model records.
 */
public final class ScenarioLoader {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private final SchemaValidator scenarioSchema = new SchemaValidator(SchemaValidator.SCENARIO);
    private final SchemaValidator modelExpectSchema = new SchemaValidator(SchemaValidator.MODEL_EXPECT);
    private final SchemaValidator exemptionsSchema = new SchemaValidator(SchemaValidator.COVERAGE_EXEMPTIONS);

    /** Loads and validates a scenario file. */
    public ScenarioFile load(Path file) {
        return parse(readTree(file), file.toString());
    }

    /** Parses and validates scenario JSON text. {@code source} names it in messages. */
    public ScenarioFile parse(String json, String source) {
        return parse(readTree(json, source), source);
    }

    /** Validates and maps a scenario document. */
    public ScenarioFile parse(JsonNode document, String source) {
        scenarioSchema.requireValid(document, source);
        return mapFile(document, source);
    }

    /** Loads and validates a {@code model-expect.json}. */
    public ModelExpectations loadModelExpectations(Path file) {
        JsonNode document = readTree(file);
        modelExpectSchema.requireValid(document, file.toString());
        Map<String, ModelExpectations.ProcessExpectation> processes = new LinkedHashMap<>();
        document.get("processes").properties().forEach(entry -> {
            JsonNode p = entry.getValue();
            Map<String, ModelExpectations.ElementExpectation> elements = new LinkedHashMap<>();
            if (p.has("elements")) {
                p.get("elements").properties().forEach(e -> elements.put(e.getKey(),
                        new ModelExpectations.ElementExpectation(text(e.getValue(), "type"), map(e.getValue().get("attributes")))));
            }
            JsonNode starters = p.get("candidateStarters");
            processes.put(entry.getKey(), new ModelExpectations.ProcessExpectation(
                    map(p.get("definition")),
                    map(p.get("process")),
                    starters != null && starters.has("users") ? strings(starters.get("users")) : null,
                    starters != null && starters.has("groups") ? strings(starters.get("groups")) : null,
                    extensions(p.get("extensions")),
                    elements));
        });
        return new ModelExpectations(processes);
    }

    private static ModelExpectations.ExtensionsExpectation extensions(JsonNode node) {
        if (node == null) {
            return null;
        }
        return new ModelExpectations.ExtensionsExpectation(map(node.get("properties")), map(node.get("mappings")), map(node.get("constants")));
    }

    /** Loads and validates a {@code coverage-exemptions.json}. */
    public CoverageExemptions loadExemptions(Path file) {
        JsonNode document = readTree(file);
        exemptionsSchema.requireValid(document, file.toString());
        List<CoverageExemptions.Exemption> list = new ArrayList<>();
        for (JsonNode e : document.get("exemptions")) {
            list.add(new CoverageExemptions.Exemption(text(e, "process"), text(e, "element"), text(e, "reason")));
        }
        return new CoverageExemptions(list);
    }

    // ---- scenario file ----------------------------------------------------------------------------------------------

    private ScenarioFile mapFile(JsonNode d, String source) {
        Map<String, List<String>> users = new LinkedHashMap<>();
        if (d.has("users")) {
            d.get("users").properties().forEach(e -> users.put(e.getKey(), strings(e.getValue())));
        }
        List<Scenario> scenarios = new ArrayList<>();
        if (d.has("scenarios")) {
            for (JsonNode s : d.get("scenarios")) {
                scenarios.add(mapScenario(s));
            }
        }
        List<DecisionCase> decisions = new ArrayList<>();
        if (d.has("decisions")) {
            for (JsonNode c : d.get("decisions")) {
                JsonNode expect = c.get("expect");
                List<Map<String, Object>> rows = null;
                if (expect.has("result")) {
                    rows = new ArrayList<>();
                    for (JsonNode row : expect.get("result")) {
                        rows.add(map(row));
                    }
                }
                decisions.add(new DecisionCase(text(c, "name"), text(c, "decision"), map(c.get("inputs")), rows,
                        expect.has("matchedRules") ? strings(expect.get("matchedRules")) : null));
            }
        }
        return new ScenarioFile(text(d, "name"), text(d, "description"), users, instant(d.get("clock")), scenarios, decisions, source);
    }

    private Scenario mapScenario(JsonNode s) {
        JsonNode st = s.get("start");
        Start start = new Start(text(st, "process"), text(st, "message"), text(st, "signal"), text(st, "timer"),
                text(st, "businessKey"), text(st, "user"), map(st.get("variables")), failure(st));
        List<Step> steps = new ArrayList<>();
        if (s.has("steps")) {
            for (JsonNode step : s.get("steps")) {
                steps.add(mapStep(step));
            }
        }
        return new Scenario(text(s, "name"), text(s, "description"), instant(s.get("clock")), start, steps,
                s.has("expect") ? mapExpect(s.get("expect")) : null);
    }

    private Expect mapExpect(JsonNode e) {
        List<DeadLetterExpectation> deadLetters = null;
        if (e.has("deadLetterJobs")) {
            deadLetters = new ArrayList<>();
            for (JsonNode j : e.get("deadLetterJobs")) {
                deadLetters.add(new DeadLetterExpectation(text(j, "activity"), text(j, "exceptionMessageContains")));
            }
        }
        return new Expect(text(e, "state"),
                e.has("endEvents") ? strings(e.get("endEvents")) : null,
                e.has("path") ? path(e.get("path")) : null,
                e.has("variables") ? map(e.get("variables")) : null,
                e.has("absentVariables") ? strings(e.get("absentVariables")) : null,
                deadLetters);
    }

    private PathExpectation path(JsonNode p) {
        List<List<String>> order = new ArrayList<>();
        if (p.has("order")) {
            for (JsonNode pair : p.get("order")) {
                order.add(strings(pair));
            }
        }
        return new PathExpectation(strings(p.get("contains")), strings(p.get("notContains")), order,
                strings(p.get("sequenceFlows")), strings(p.get("notSequenceFlows")));
    }

    private Step mapStep(JsonNode step) {
        Map.Entry<String, JsonNode> entry = step.properties().iterator().next();
        String type = entry.getKey();
        JsonNode v = entry.getValue();
        return switch (type) {
            case "expectTask" -> mapExpectTask(v);
            case "claim" -> new Step.Claim(text(v, "activity"), text(v, "user"), taskMatch(v));
            case "release" -> new Step.Release(text(v, "activity"), text(v, "user"), taskMatch(v));
            case "assign" -> new Step.Assign(text(v, "activity"), text(v, "assignee"), text(v, "user"), taskMatch(v));
            case "completeTask" -> new Step.CompleteTask(text(v, "activity"), text(v, "user"), map(v.get("variables")),
                    taskMatch(v), failure(v));
            case "expectConnectorCall" -> new Step.ExpectConnectorCall(text(v, "activity"), text(v, "connector"),
                    integer(v, "count"), integer(v, "call"),
                    v.has("inbound") ? map(v.get("inbound")) : null, v.has("outbound") ? map(v.get("outbound")) : null,
                    v.path("partial").asBoolean(false));
            case "expectChildInstance" -> new Step.ExpectChildInstance(text(v, "callActivity"), text(v, "process"),
                    v.has("businessKey") ? MAPPER.convertValue(v.get("businessKey"), Object.class) : null, v.has("businessKey"),
                    integer(v, "count"), integer(v, "call"), text(v, "state"),
                    v.has("startVariables") ? map(v.get("startVariables")) : null,
                    v.has("variables") ? map(v.get("variables")) : null,
                    v.has("absentVariables") ? strings(v.get("absentVariables")) : null,
                    v.has("path") ? path(v.get("path")) : null);
            case "message" -> new Step.Message(text(v, "name"), text(v, "correlationKey"), map(v.get("variables")),
                    text(v, "user"), failure(v));
            case "signal" -> new Step.Signal(text(v, "name"), map(v.get("variables")), text(v, "user"));
            case "triggerReceiveTask" -> new Step.TriggerReceiveTask(text(v, "activity"), map(v.get("variables")), taskMatch(v));
            case "expectTimer" -> new Step.ExpectTimer(text(v, "activity"), integer(v, "count"),
                    v.has("dueDate") ? MAPPER.convertValue(v.get("dueDate"), Object.class) : null, v.has("dueDate"));
            case "fireTimer" -> new Step.FireTimer(text(v, "activity"), v.path("all").asBoolean(false));
            case "advanceClock" -> new Step.AdvanceClock(v.asText());
            case "executeJobs" -> new Step.ExecuteJobs(integer(v, "maxRounds"), integer(v, "timeoutMs"));
            case "failJobUntilDeadLetter" -> new Step.FailJobUntilDeadLetter(text(v, "activity"), integer(v, "maxAttempts"));
            case "expectActive" -> mapExpectActive(v);
            case "setVariables" -> new Step.SetVariables(map(v));
            default -> throw new IllegalStateException("Unknown step type '" + type + "' passed schema validation");
        };
    }

    private Step.ExpectTask mapExpectTask(JsonNode v) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (String key : List.of("name", "description", "assignee", "owner", "priority", "category", "formKey", "dueDate",
                "candidateUsers", "candidateGroups", "identityLinks")) {
            if (v.has(key)) {
                fields.put(key, MAPPER.convertValue(v.get(key), Object.class));
            }
        }
        if (v.has("localVariables")) {
            fields.put("localVariables", map(v.get("localVariables")));
        }
        return new Step.ExpectTask(text(v, "activity"), taskMatch(v), integer(v, "count"), fields,
                v.path("partial").asBoolean(false), strings(v.get("visibleTo")), strings(v.get("notVisibleTo")));
    }

    private Step.ExpectActive mapExpectActive(JsonNode v) {
        if (v.isArray()) {
            return new Step.ExpectActive(strings(v), null, null);
        }
        return new Step.ExpectActive(v.has("exactly") ? strings(v.get("exactly")) : null,
                v.has("contains") ? strings(v.get("contains")) : null,
                v.has("notContains") ? strings(v.get("notContains")) : null);
    }

    private Step.TaskMatch taskMatch(JsonNode v) {
        JsonNode m = v.get("match");
        return m == null ? null : new Step.TaskMatch(map(m));
    }

    private Step.ExpectedFailure failure(JsonNode v) {
        JsonNode f = v.get("expectFailure");
        return f == null ? null : new Step.ExpectedFailure(text(f, "exception"), text(f, "messageContains"));
    }

    // ---- helpers ----------------------------------------------------------------------------------------------------

    private static String text(JsonNode node, String field) {
        JsonNode v = node == null ? null : node.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static Integer integer(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? null : v.asInt();
    }

    private static List<String> strings(JsonNode node) {
        if (node == null || node.isNull()) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (JsonNode n : node) {
            out.add(n.asText());
        }
        return out;
    }

    private static Instant instant(JsonNode node) {
        return node == null || node.isNull() ? null : OffsetDateTime.parse(node.asText()).toInstant();
    }

    /** Converts an object node to a mutable-order map with plain Java values (Integer/Long/Double, String, List, Map). */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(JsonNode node) {
        if (node == null || node.isNull()) {
            return new LinkedHashMap<>();
        }
        return MAPPER.convertValue(node, LinkedHashMap.class);
    }

    private static JsonNode readTree(Path file) {
        try {
            return MAPPER.readTree(Files.readString(file));
        } catch (JsonProcessingException e) {
            throw new InvalidScenarioException(file.toString(), "not valid JSON: " + e.getOriginalMessage(), e);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + file, e);
        }
    }

    private static JsonNode readTree(String json, String source) {
        try {
            return MAPPER.readTree(json);
        } catch (JsonProcessingException e) {
            throw new InvalidScenarioException(source, "not valid JSON: " + e.getOriginalMessage(), e);
        }
    }
}
