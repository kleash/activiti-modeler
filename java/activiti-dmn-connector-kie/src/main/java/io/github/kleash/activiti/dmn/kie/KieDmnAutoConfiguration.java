package io.github.kleash.activiti.dmn.kie;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

import io.github.kleash.activiti.dmn.DmnConnectorAutoConfiguration;
import io.github.kleash.activiti.dmn.DmnConnectorProperties;
import io.github.kleash.activiti.dmn.DmnEvaluator;

/**
 * Selects the KIE engine for the DMN connector when {@code activiti.dmn.engine=kie}. It is applied before
 * {@link DmnConnectorAutoConfiguration}, whose default Operaton evaluator then backs off.
 */
@AutoConfiguration(before = DmnConnectorAutoConfiguration.class)
@ConditionalOnClass(KieDmnEvaluator.class)
@ConditionalOnProperty(prefix = "activiti.dmn", name = "engine", havingValue = KieDmnEvaluator.NAME)
@EnableConfigurationProperties(DmnConnectorProperties.class)
public class KieDmnAutoConfiguration {

    /**
     * @param properties the {@code activiti.dmn} properties
     * @return the KIE evaluator
     */
    @Bean
    @ConditionalOnMissingBean(DmnEvaluator.class)
    public DmnEvaluator kieDmnEvaluator(DmnConnectorProperties properties) {
        return new KieDmnEvaluator(properties.getCacheSize());
    }
}
