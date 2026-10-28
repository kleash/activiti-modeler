package io.github.kleash.activiti.modeler;

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

/** The real server configuration (security, CORS, connectors, mail, static app) under MockMvc. */
@SpringBootTest
@AutoConfigureMockMvc
abstract class AbstractServerTest {

    static final Path WORKSPACE = workspace();

    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper mapper;
    @Autowired protected RepositoryService repository;
    @Autowired protected RuntimeService runtime;

    private static Path workspace() {
        try {
            return Files.createTempDirectory("modeler-server-workspace");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void workspaceDirectory(DynamicPropertyRegistry registry) {
        registry.add("modeler.workspace.dir", WORKSPACE::toString);
    }

    @AfterEach
    void cleanUp() {
        repository.createDeploymentQuery().list().forEach(d -> repository.deleteDeployment(d.getId(), true));
    }

    static String fixture(String name) {
        try (InputStream in = AbstractServerTest.class.getResourceAsStream("/fixtures/" + name)) {
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

    protected MvcResult perform(String user, HttpMethod method, String path, Object body) throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.request(method, path);
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

    protected JsonNode send(String user, HttpMethod method, String path, Object body, int status) throws Exception {
        MvcResult result = perform(user, method, path, body);
        org.assertj.core.api.Assertions.assertThat(result.getResponse().getStatus())
                .as("%s %s -> %s", method, path, result.getResponse().getContentAsString()).isEqualTo(status);
        return json(result);
    }

    protected List<Map<String, String>> files(Map<String, String> first, Map<String, String>... more) {
        List<Map<String, String>> out = new ArrayList<>();
        out.add(first);
        out.addAll(List.of(more));
        return out;
    }
}
