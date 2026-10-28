package io.github.kleash.activiti.dmn.kie.e2e;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import io.github.kleash.activiti.dmn.DmnEvaluator;
import io.github.kleash.activiti.dmn.e2e.AbstractCorpusEndToEndTest;
import io.github.kleash.activiti.dmn.kie.KieDmnEvaluator;

/**
 * Base of the end-to-end tests that run a corpus project on embedded Activiti 9.0.0 with
 * {@code activiti.dmn.engine=kie}: the oracles that hold for Operaton must hold for KIE.
 */
abstract class AbstractKieCorpusTest extends AbstractCorpusEndToEndTest {

    @Autowired private DmnEvaluator evaluator;

    @Test
    void kieIsTheEngineInUse() {
        assertThat(evaluator).isInstanceOf(KieDmnEvaluator.class);
        assertThat(decisions.evaluator()).isSameAs(evaluator);
    }
}
