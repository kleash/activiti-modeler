package io.github.kleash.compat;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;

import org.activiti.api.process.model.ProcessInstance;
import org.activiti.api.process.model.builders.ProcessPayloadBuilder;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.api.runtime.shared.query.Pageable;
import org.activiti.api.task.model.Task;
import org.activiti.api.task.model.builders.TaskPayloadBuilder;
import org.activiti.api.task.runtime.TaskRuntime;
import org.activiti.engine.HistoryService;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.impl.identity.Authentication;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootVersion;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;

@SpringBootTest
class CompatCheckTest {

    @Autowired private ProcessRuntime processRuntime;
    @Autowired private TaskRuntime taskRuntime;
    @Autowired private RepositoryService repositoryService;
    @Autowired private HistoryService historyService;
    @Autowired private UserDetailsService userDetailsService;

    @BeforeEach
    void logInAsAlice() {
        UserDetails alice = userDetailsService.loadUserByUsername("alice");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(alice, alice.getPassword(), alice.getAuthorities()));
        // ProcessRuntime does not bridge Spring Security into the engine's identity thread-local,
        // so activiti:initiator stays null unless the host application sets it.
        Authentication.setAuthenticatedUserId(alice.getUsername());
        System.out.printf("Running on Spring Boot %s, Activiti engine %s, Java %s%n",
            SpringBootVersion.getVersion(),
            activitiVersion(), Runtime.version());
    }

    private static String activitiVersion() {
        try (var in = org.activiti.engine.ProcessEngine.class.getResourceAsStream(
                "/META-INF/maven/org.activiti/activiti-engine/pom.properties")) {
            var props = new java.util.Properties();
            props.load(in);
            return props.getProperty("version");
        } catch (Exception e) {
            return "unknown";
        }
    }

    @AfterEach
    void logOut() {
        SecurityContextHolder.clearContext();
        Authentication.setAuthenticatedUserId(null);
    }

    @Test
    void autoDeploysProcessFromClasspath() {
        assertThat(repositoryService.createProcessDefinitionQuery()
            .processDefinitionKey("compatCheck").count()).isEqualTo(1);
    }

    @Test
    void highScoreGoesThroughUserTask() {
        ProcessInstance instance = processRuntime.start(ProcessPayloadBuilder.start()
            .withProcessDefinitionKey("compatCheck")
            .withVariable("customerName", "Ada")
            .withVariable("amount", 5000)
            .build());

        Task review = taskRuntime.tasks(Pageable.of(0, 10)).getContent().stream()
            .filter(t -> instance.getId().equals(t.getProcessInstanceId()))
            .findFirst().orElseThrow();
        assertThat(review.getName()).isEqualTo("Review");
        assertThat(review.getPriority()).isEqualTo(80);

        taskRuntime.claim(TaskPayloadBuilder.claim().withTaskId(review.getId()).build());
        taskRuntime.complete(TaskPayloadBuilder.complete().withTaskId(review.getId()).build());

        assertFinishedWith(instance.getId(), "Hello Ada / high");
    }

    @Test
    void lowScoreTakesDefaultFlow() {
        ProcessInstance instance = processRuntime.start(ProcessPayloadBuilder.start()
            .withProcessDefinitionKey("compatCheck")
            .withVariable("customerName", "Bob")
            .withVariable("amount", 10)
            .build());

        assertFinishedWith(instance.getId(), "Hello Bob / low");
    }

    private void assertFinishedWith(String processInstanceId, String expectedLabel) {
        assertThat(historyService.createHistoricProcessInstanceQuery()
            .processInstanceId(processInstanceId).finished().count()).isEqualTo(1);
        Map<String, Object> vars = new HashMap<>();
        historyService.createHistoricVariableInstanceQuery().processInstanceId(processInstanceId).list()
            .forEach(v -> vars.put(v.getVariableName(), v.getValue()));
        System.out.println("Historic variables for " + processInstanceId + ": " + vars);
        assertThat(vars).containsEntry("label", expectedLabel).containsEntry("initiator", "alice");
    }
}
