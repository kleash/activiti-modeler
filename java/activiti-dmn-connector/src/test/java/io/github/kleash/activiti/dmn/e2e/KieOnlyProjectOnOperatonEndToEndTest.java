package io.github.kleash.activiti.dmn.e2e;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.Map;

import org.activiti.api.process.model.builders.ProcessPayloadBuilder;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.engine.HistoryService;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.impl.identity.Authentication;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.github.kleash.activiti.dmn.DmnEvaluationService;
import io.github.kleash.activiti.dmn.DmnModelException;

/**
 * The KIE-only corpus project (business knowledge model, boxed context) on the default Operaton engine: the decision
 * task fails loudly and says how to fix it, instead of returning a wrong answer.
 */
@SpringBootTest(classes = E2eApplication.class)
class KieOnlyProjectOnOperatonEndToEndTest {

    private static final Path PROJECT = AbstractCorpusEndToEndTest.corpus("C17-dmn-drd-kie");

    @DynamicPropertySource
    static void deployProject(DynamicPropertyRegistry registry) {
        AbstractCorpusEndToEndTest.deploy(registry, PROJECT);
    }

    @Autowired private ProcessRuntime processRuntime;
    @Autowired private HistoryService historyService;
    @Autowired private RepositoryService repositoryService;
    @Autowired private DmnEvaluationService decisions;
    @Autowired private UserDetailsService users;

    @BeforeEach
    void logIn() {
        UserDetails alice = users.loadUserByUsername("alice");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(alice, alice.getPassword(), alice.getAuthorities()));
        Authentication.setAuthenticatedUserId("alice");
    }

    @AfterEach
    void logOut() {
        SecurityContextHolder.clearContext();
        Authentication.setAuthenticatedUserId(null);
    }

    @Test
    void decisionTaskFailsWithAPointerToTheKieEngineAndLeavesNoInstance() {
        assertThatThrownBy(() -> processRuntime.start(ProcessPayloadBuilder.start().withProcessDefinitionKey("pricing")
            .withVariables(Map.of("basePrice", 200, "loyaltyYears", 5)).build()))
            .hasStackTraceContaining(DmnModelException.class.getName())
            .hasStackTraceContaining("Decision task 'decidePrice'")
            .hasStackTraceContaining("business knowledge model")
            .hasStackTraceContaining("activiti.dmn.engine=kie");

        assertThat(historyService.createHistoricProcessInstanceQuery().processDefinitionKey("pricing").count()).isZero();
    }

    @Test
    void directEvaluationFailsTheSameWay() {
        String deployment = repositoryService.createDeploymentQuery().singleResult().getId();

        assertThatThrownBy(() -> decisions.evaluateInDeployment(deployment, "pricing", Map.of("basePrice", 200, "loyaltyYears", 5)))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("activiti.dmn.engine=kie");
    }
}
