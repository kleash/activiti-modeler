package io.github.kleash.activiti.dmn;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.Deployment;
import org.activiti.engine.repository.DeploymentQuery;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.FilteredClassLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import io.github.kleash.activiti.scenario.run.DecisionEvaluator;

/** The adapter between the scenario runner's {@code decisions[]} port and the DMN evaluation service. */
class ScenarioDecisionEvaluatorTest {

    private final RepositoryService repository = mock(RepositoryService.class);
    private final DmnEvaluationService service = mock(DmnEvaluationService.class);

    private void deployments(String... idsNewestFirst) {
        List<Deployment> list = new java.util.ArrayList<>();
        for (String id : idsNewestFirst) {
            Deployment d = mock(Deployment.class);
            when(d.getId()).thenReturn(id);
            list.add(d);
        }
        DeploymentQuery query = mock(DeploymentQuery.class);
        when(repository.createDeploymentQuery()).thenReturn(query);
        when(query.orderByDeploymentId()).thenReturn(query);
        when(query.desc()).thenReturn(query);
        when(query.list()).thenReturn(list);
    }

    private static DmnEvaluation evaluation(String decision, String column, Object value, String rule) {
        DecisionEvaluation d = new DecisionEvaluation(decision, decision, DmnModel.Kind.DECISION_TABLE, DmnHitPolicy.UNIQUE, DmnAggregation.NONE,
            false, decision, List.of(Map.of(column, value)), List.of(rule));
        return new DmnEvaluation(d, List.of(d));
    }

    @Test
    void rowsAndMatchedRulesComeFromTheNewestDeploymentThatResolvesTheDecision() {
        deployments("d3", "d2", "d1");
        when(service.evaluateInDeployment(eq("d3"), eq("grade"), any())).thenThrow(new DmnResolutionException("no such decision in d3"));
        when(service.evaluateInDeployment(eq("d2"), eq("grade"), any())).thenReturn(evaluation("grade", "grade", "pass", "R1"));

        DecisionEvaluator.Outcome outcome = new ScenarioDecisionEvaluator(service, repository).evaluate("grade", Map.of("score", 70));

        assertThat(outcome.rows()).containsExactly(Map.of("grade", "pass"));
        assertThat(outcome.matchedRules()).containsExactly("R1");
    }

    @Test
    void aDecisionThatNoDeploymentHoldsListsEveryMiss() {
        deployments("d2", "d1");
        when(service.evaluateInDeployment(any(), eq("nope"), any())).thenThrow(new DmnResolutionException("not here"));

        assertThatThrownBy(() -> new ScenarioDecisionEvaluator(service, repository).evaluate("nope", Map.of()))
            .isInstanceOf(DmnResolutionException.class)
            .hasMessageContaining("Decision 'nope' was not found in any of the 2 deployment(s)")
            .hasMessageContaining("deployment d2: not here").hasMessageContaining("deployment d1: not here");
    }

    @Test
    void anInvalidDmnIsNotMistakenForAMissingDecision() {
        deployments("d2", "d1");
        when(service.evaluateInDeployment(eq("d2"), any(), any())).thenThrow(new DmnModelException("broken.dmn: not well-formed"));

        assertThatThrownBy(() -> new ScenarioDecisionEvaluator(service, repository).evaluate("grade", Map.of()))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("broken.dmn");
    }

    @Test
    void nothingDeployedIsReported() {
        deployments();

        assertThatThrownBy(() -> new ScenarioDecisionEvaluator(service, repository).evaluate("grade", Map.of()))
            .hasMessageContaining("Cannot evaluate decision 'grade': nothing is deployed");
    }

    // ---- registration -----------------------------------------------------------------------------------------------

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(DmnConnectorAutoConfiguration.class))
        .withBean(RepositoryService.class, () -> mock(RepositoryService.class));

    @Test
    void theAutoConfigurationRegistersTheAdapterAsTheRunnersDecisionEvaluator() {
        contextRunner.run(context -> assertThat(context.getBean(DecisionEvaluator.class)).isInstanceOf(ScenarioDecisionEvaluator.class));
    }

    @Test
    void anApplicationDecisionEvaluatorWins() {
        DecisionEvaluator mine = (decision, inputs) -> new DecisionEvaluator.Outcome(List.of(), List.of());
        contextRunner.withBean(DecisionEvaluator.class, () -> mine)
            .run(context -> assertThat(context.getBean(DecisionEvaluator.class)).isSameAs(mine));
    }

    @Test
    void withoutTheScenarioRunnerOnTheClasspathTheConnectorStillWorksAndNoAdapterExists() {
        contextRunner.withClassLoader(new FilteredClassLoader("io.github.kleash.activiti.scenario")).run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasBean("dmn-connector.EXECUTE_TABLE");
            assertThat(context).doesNotHaveBean(ScenarioDecisionEvaluator.class);
        });
    }

    @Test
    void theAdapterIsSwitchedOffWithTheConnector() {
        contextRunner.withPropertyValues("activiti.dmn.enabled=false").run(context -> assertThat(context).doesNotHaveBean(DecisionEvaluator.class));
    }
}
