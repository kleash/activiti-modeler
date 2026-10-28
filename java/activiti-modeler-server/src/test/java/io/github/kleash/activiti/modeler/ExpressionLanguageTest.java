package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.el.ExpressionFactory;

import org.junit.jupiter.api.Test;

/**
 * The DMN connector brings Operaton DMN, and with it Operaton's JUEL, which also registers as a {@code jakarta.el.ExpressionFactory}.
 * Activiti takes its expression language from {@code ExpressionFactory.newInstance()} (BPMN expressions, mapping expressions, JUEL
 * scripts), so the engine of an app with the connector must still get Activiti's JUEL, whatever the order of the jars (Maven 3.8 and
 * 3.9 order them differently).
 */
class ExpressionLanguageTest {

    @Test
    void theEngineKeepsActivitisExpressionLanguage() {
        assertThat(ExpressionFactory.newInstance()).isInstanceOf(org.activiti.core.el.juel.ExpressionFactoryImpl.class);
    }
}
