package io.github.kleash.activiti.rest.core;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;

import java.util.Map;

import org.activiti.engine.RuntimeService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.rest.core.testapp.FlakyDelegate;
import io.github.kleash.activiti.rest.core.testapp.Fixtures;
import io.github.kleash.activiti.rest.core.testapp.TestApplication;

/** Shared plumbing: MockMvc against a real embedded Activiti, HTTP Basic users of {@code TestSecurity}, JSON helpers. */
@SpringBootTest(classes = TestApplication.class)
@AutoConfigureMockMvc
abstract class AbstractApiTest {

    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper mapper;
    @Autowired protected Fixtures fixtures;
    @Autowired protected RuntimeService runtime;

    protected String base() {
        return "/api";
    }

    @BeforeEach
    void deployFixtures() {
        fixtures.deploy();
        FlakyDelegate.FAIL.set(true);
    }

    /** Ends everything a test left running, so that tests do not see each other's instances. */
    @AfterEach
    void cleanUp() {
        runtime.createProcessInstanceQuery().list().stream().filter(i -> i.getSuperExecutionId() == null)
                .forEach(i -> runtime.deleteProcessInstance(i.getId(), "test cleanup"));
        org.activiti.engine.impl.identity.Authentication.setAuthenticatedUserId(null);
    }

    /** The API leaves out fields that are {@code null}: absent and null are the same. */
    protected static boolean absent(JsonNode node) {
        return node.isMissingNode() || node.isNull();
    }

    protected MvcResult perform(String user, HttpMethod method, String path, Object body) throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.request(method, base() + path);
        if (user != null) {
            request.with(httpBasic(user, user));
        }
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(body instanceof String s ? s : mapper.writeValueAsString(body));
        }
        return mvc.perform(request).andReturn();
    }

    protected JsonNode json(MvcResult result) throws Exception {
        String content = result.getResponse().getContentAsString();
        return content.isBlank() ? mapper.nullNode() : mapper.readTree(content);
    }

    /** GET as {@code user}, expecting 200. */
    protected JsonNode get(String user, String path) throws Exception {
        MvcResult result = perform(user, HttpMethod.GET, path, null);
        expect(result, 200);
        return json(result);
    }

    /** POST/PUT/DELETE as {@code user}, expecting {@code status}; returns the body. */
    protected JsonNode send(String user, HttpMethod method, String path, Object body, int status) throws Exception {
        MvcResult result = perform(user, method, path, body);
        expect(result, status);
        return json(result);
    }

    protected JsonNode post(String user, String path, Object body, int status) throws Exception {
        return send(user, HttpMethod.POST, path, body, status);
    }

    protected void expect(MvcResult result, int status) throws Exception {
        org.assertj.core.api.Assertions.assertThat(result.getResponse().getStatus())
                .as("%s %s -> %s", result.getRequest().getMethod(), result.getRequest().getRequestURI(), result.getResponse().getContentAsString())
                .isEqualTo(status);
    }

    /** A problem+json response: status and content type checked, document returned. */
    protected JsonNode problem(MvcResult result, int status) throws Exception {
        expect(result, status);
        org.assertj.core.api.Assertions.assertThat(result.getResponse().getContentType()).startsWith("application/problem+json");
        JsonNode problem = json(result);
        org.assertj.core.api.Assertions.assertThat(problem.path("status").asInt()).isEqualTo(status);
        org.assertj.core.api.Assertions.assertThat(problem.path("title").asText()).isNotBlank();
        org.assertj.core.api.Assertions.assertThat(problem.has("detail")).isTrue();
        return problem;
    }

    protected String start(String user, String key, Map<String, Object> variables) throws Exception {
        JsonNode started = post(user, "/process-instances", Map.of("processKey", key, "variables", variables), 201);
        return started.path("id").asText();
    }
}
