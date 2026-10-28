package io.github.kleash.activiti.dmn;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.activiti.api.process.model.IntegrationContext;
import org.activiti.api.runtime.model.impl.IntegrationContextImpl;
import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.ProcessDefinition;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import io.github.kleash.activiti.dmn.testing.FolderRepository;

/** The connector in isolation: input handling, output contract, error context, deployment lookup. */
class DmnConnectorTest {

    private RepositoryService repository;
    private List<Map<String, Object>> seenInputs;
    private DmnConnector connector;

    @BeforeEach
    void connector() {
        repository = FolderRepository.of(Path.of("..", "..", "corpus", "C16-dmn-hit-policies", "seed", "processes").toAbsolutePath().normalize());
        ProcessDefinition definition = mock(ProcessDefinition.class);
        when(definition.getDeploymentId()).thenReturn(FolderRepository.DEPLOYMENT_ID);
        when(repository.getProcessDefinition("pd-1")).thenReturn(definition);
        seenInputs = new ArrayList<>();
        DmnEvaluator recording = new DmnEvaluator() {
            private final OperatonDmnEvaluator delegate = new OperatonDmnEvaluator();

            @Override
            public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
                seenInputs.add(new LinkedHashMap<>(inputs));
                return delegate.evaluate(dmn, decisionRef, inputs);
            }

            @Override
            public String engineName() {
                return delegate.engineName();
            }
        };
        DmnEvaluationService service = new DmnEvaluationService(recording, new DmnDeploymentResolver(repository, 8));
        connector = new DmnConnector(service, repository, 8);
    }

    private static IntegrationContextImpl context(Map<String, Object> inbound) {
        IntegrationContextImpl context = new IntegrationContextImpl();
        context.setClientId("decideTask");
        context.setProcessDefinitionId("pd-1");
        context.addInBoundVariables(inbound);
        return context;
    }

    @Test
    void constantsAreTheContract() {
        assertThat(DmnConnector.IMPLEMENTATION).isEqualTo("dmn-connector.EXECUTE_TABLE");
        assertThat(DmnConnector.DECISION_TABLE_CONSTANT).isEqualTo("_activiti_dmn_table_");
    }

    @Test
    void evaluatesTheNamedDecisionAndAddsTheContractVariables() {
        IntegrationContext result = connector.apply(context(Map.of("_activiti_dmn_table_", "uniqueGrade", "score", 85)));

        assertThat(result.getOutBoundVariables()).containsEntry("grade", "high")
            .containsEntry("_activiti_dmn_matched_", true).containsEntry("_activiti_dmn_matched_rules_", List.of("uniqueGrade_high"));
    }

    @Test
    void reservedConstantsNeverReachTheEngineAsInputs() {
        Map<String, Object> inbound = new LinkedHashMap<>();
        inbound.put("_activiti_dmn_table_", "uniqueGrade");
        inbound.put("_activiti_something_", "x");
        inbound.put("score", 85);

        connector.apply(context(inbound));

        assertThat(seenInputs).containsExactly(Map.of("score", 85));
    }

    @Test
    void multiResultDecisionsAreReturnedUnderTheDecisionId() {
        IntegrationContext result = connector.apply(context(Map.of("_activiti_dmn_table_", "outputOrderBadges", "score", 85)));

        assertThat(result.getOutBoundVariables()).containsEntry("outputOrderBadges",
            List.of(Map.of("badge", "star"), Map.of("badge", "achiever"), Map.of("badge", "participant")));
    }

    @Test
    void noMatchEmitsOnlyTheMatchedVariables() {
        IntegrationContext result = connector.apply(context(Map.of("_activiti_dmn_table_", "routeByAmount", "amount", 99999)));

        assertThat(result.getOutBoundVariables()).containsOnlyKeys("_activiti_dmn_matched_", "_activiti_dmn_matched_rules_")
            .containsEntry("_activiti_dmn_matched_", false);
    }

    @Test
    void referenceByFileBaseNameWorks() {
        IntegrationContext result = connector.apply(context(Map.of("_activiti_dmn_table_", "routing", "amount", 500)));

        assertThat(result.getOutBoundVariables()).containsEntry("route", "standard");
    }

    @Test
    void missingConstantIsAResolutionErrorNamingTheTask() {
        assertThatThrownBy(() -> connector.apply(context(Map.of("score", 1))))
            .isInstanceOf(DmnResolutionException.class).hasMessageContaining("Decision task 'decideTask'").hasMessageContaining("_activiti_dmn_table_");
        assertThatThrownBy(() -> connector.apply(context(Map.of("_activiti_dmn_table_", " "))))
            .isInstanceOf(DmnResolutionException.class);
    }

    @Test
    void errorsKeepTheirTypeAndGainTheTaskContext() {
        assertThatThrownBy(() -> connector.apply(context(Map.of("_activiti_dmn_table_", "nope"))))
            .isInstanceOf(DmnResolutionException.class).hasMessageContaining("Decision task 'decideTask' (process definition pd-1)").hasMessageContaining("'nope'");

        DmnConnector failing = new DmnConnector(new DmnEvaluationService(new DmnEvaluator() {
            @Override
            public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
                throw new DmnModelException("bad model");
            }

            @Override
            public String engineName() {
                return "failing";
            }
        }, new DmnDeploymentResolver(repository, 8)), repository, 8);
        assertThatThrownBy(() -> failing.apply(context(Map.of("_activiti_dmn_table_", "uniqueGrade"))))
            .isInstanceOf(DmnModelException.class).hasMessageContaining("Decision task 'decideTask'").hasMessageContaining("bad model");
    }

    @Test
    void engineFailuresAreWrappedWithTheTaskContext() {
        DmnConnector failing = new DmnConnector(new DmnEvaluationService(new DmnEvaluator() {
            @Override
            public DmnEvaluation evaluate(DmnResource dmn, String decisionRef, Map<String, Object> inputs) {
                throw new DmnException("engine exploded");
            }

            @Override
            public String engineName() {
                return "failing";
            }
        }, new DmnDeploymentResolver(repository, 8)), repository, 8);

        assertThatThrownBy(() -> failing.apply(context(Map.of("_activiti_dmn_table_", "uniqueGrade"))))
            .isExactlyInstanceOf(DmnException.class).hasMessageContaining("Decision task 'decideTask'").hasMessageContaining("engine exploded");
    }

    @Test
    void processDefinitionToDeploymentLookupIsCached() {
        connector.apply(context(Map.of("_activiti_dmn_table_", "uniqueGrade", "score", 1)));
        connector.apply(context(Map.of("_activiti_dmn_table_", "uniqueGrade", "score", 2)));

        verify(repository, times(1)).getProcessDefinition("pd-1");
    }
}
