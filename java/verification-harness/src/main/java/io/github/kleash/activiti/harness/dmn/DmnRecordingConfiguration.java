package io.github.kleash.activiti.harness.dmn;

import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Role;

import io.github.kleash.activiti.dmn.DmnEvaluator;

/**
 * Logs every evaluation of the project's {@link DmnEvaluator} (see {@link DmnEvaluationLog}). Part of every project
 * context; a project without DMN simply has an empty log.
 */
@Configuration(proxyBeanMethods = false)
public class DmnRecordingConfiguration {

    /** Static, like the BeanPostProcessor that uses it: neither needs this configuration class to be instantiated early. */
    @Bean
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    public static DmnEvaluationLog dmnEvaluationLog() {
        return new DmnEvaluationLog();
    }

    /** Static so that it is in place before the evaluator is created. */
    @Bean
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    public static BeanPostProcessor recordingDmnEvaluatorPostProcessor(DmnEvaluationLog log) {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                if (bean instanceof DmnEvaluator evaluator && !(bean instanceof RecordingDmnEvaluator)) {
                    return new RecordingDmnEvaluator(evaluator, log);
                }
                return bean;
            }
        };
    }
}
