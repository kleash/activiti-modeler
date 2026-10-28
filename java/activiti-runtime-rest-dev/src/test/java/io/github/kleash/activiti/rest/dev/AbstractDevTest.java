package io.github.kleash.activiti.rest.dev;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.activiti.engine.RepositoryService;
import org.activiti.engine.RuntimeService;
import org.junit.jupiter.api.AfterEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.rest.dev.testapp.TestApplication;

/** MockMvc against a real embedded Activiti with the dev endpoints on; helpers for projects and JSON. */
@SpringBootTest(classes = TestApplication.class)
@AutoConfigureMockMvc
abstract class AbstractDevTest {

    static final Path WORKSPACE = createWorkspace();

    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper mapper;
    @Autowired protected RepositoryService repository;
    @Autowired protected RuntimeService runtime;

    private static Path createWorkspace() {
        try {
            return Files.createTempDirectory("rest-dev-workspace");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void workspace(DynamicPropertyRegistry registry) {
        registry.add("modeler.workspace.dir", WORKSPACE::toString);
    }

    @AfterEach
    void cleanUp() {
        repository.createDeploymentQuery().list().forEach(d -> repository.deleteDeployment(d.getId(), true));
        org.activiti.engine.impl.identity.Authentication.setAuthenticatedUserId(null);
    }

    // ---- projects ------------------------------------------------------------------------------------------------------------

    static String resource(String name) {
        try (InputStream in = AbstractDevTest.class.getResourceAsStream(name)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(name, e);
        }
    }

    static String corpus(String project, String file) {
        try {
            return Files.readString(Path.of("..", "..", "corpus", project, "seed", "processes", file));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    static Map<String, String> file(String path, String content) {
        Map<String, String> file = new LinkedHashMap<>();
        file.put("path", path);
        file.put("content", content);
        return file;
    }

    /** The grading project: a BPMN process with a decision task, its extensions and a DMN table from the corpus. */
    static List<Map<String, String>> grading() {
        List<Map<String, String>> files = new ArrayList<>();
        files.add(file("processes/grading.bpmn20.xml", resource("/projects/grading/processes/grading.bpmn20.xml")));
        files.add(file("processes/grading-extensions.json", resource("/projects/grading/processes/grading-extensions.json")));
        files.add(file("processes/unique-grade.dmn", corpus("C16-dmn-hit-policies", "unique-grade.dmn")));
        return files;
    }

    static List<Map<String, String>> with(List<Map<String, String>> files, Map<String, String> replacement) {
        List<Map<String, String>> out = new ArrayList<>();
        boolean replaced = false;
        for (Map<String, String> f : files) {
            if (f.get("path").equals(replacement.get("path"))) {
                out.add(replacement);
                replaced = true;
            } else {
                out.add(f);
            }
        }
        if (!replaced) {
            out.add(replacement);
        }
        return out;
    }

    // ---- HTTP ----------------------------------------------------------------------------------------------------------------

    protected MvcResult perform(String user, HttpMethod method, String path, Object body) throws Exception {
        return perform(user, method, path, body, MediaType.APPLICATION_JSON);
    }

    protected MvcResult perform(String user, HttpMethod method, String path, Object body, MediaType type) throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.request(method, "/api/dev" + path);
        if (user != null) {
            request.with(httpBasic(user, user));
        }
        if (body != null) {
            request.contentType(type).content(body instanceof byte[] bytes ? bytes
                    : (body instanceof String s ? s : mapper.writeValueAsString(body)).getBytes(StandardCharsets.UTF_8));
        }
        return mvc.perform(request).andReturn();
    }

    protected JsonNode json(MvcResult result) throws Exception {
        String content = result.getResponse().getContentAsString();
        return content.isBlank() ? mapper.nullNode() : mapper.readTree(content);
    }

    protected JsonNode post(String path, Object body, int status) throws Exception {
        MvcResult result = perform("admin", HttpMethod.POST, path, body);
        org.assertj.core.api.Assertions.assertThat(result.getResponse().getStatus())
                .as("POST %s -> %s", path, result.getResponse().getContentAsString()).isEqualTo(status);
        return json(result);
    }

    protected JsonNode problem(MvcResult result, int status) throws Exception {
        org.assertj.core.api.Assertions.assertThat(result.getResponse().getStatus())
                .as("%s %s -> %s", result.getRequest().getMethod(), result.getRequest().getRequestURI(), result.getResponse().getContentAsString()).isEqualTo(status);
        org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentType()).startsWith("application/problem+json");
        return json(result);
    }

    protected JsonNode validate(Object files) throws Exception {
        return post("/validate", Map.of("files", files), 200);
    }

    /** The problems of a validation as "source/severity/key" for a path (all paths when null). */
    protected static List<String> findings(JsonNode response, String path) {
        List<String> out = new ArrayList<>();
        response.path("problems").forEach(p -> {
            if (path == null || path.equals(p.path("path").asText(null))) {
                out.add(p.path("source").asText() + "/" + p.path("severity").asText() + "/" + p.path("key").asText());
            }
        });
        return out;
    }

    protected static JsonNode problemOf(JsonNode response, String key) {
        for (JsonNode p : response.path("problems")) {
            if (key.equals(p.path("key").asText())) {
                return p;
            }
        }
        throw new AssertionError("no problem with key " + key + " in " + response.path("problems"));
    }
}
