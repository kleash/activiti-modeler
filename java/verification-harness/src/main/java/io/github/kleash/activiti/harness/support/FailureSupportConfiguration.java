package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.JavaDelegate;
import org.activiti.engine.delegate.TaskListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Beans of the error and retry corpus (C08, C19); documented in docs/corpus-support.md. */
@Configuration(proxyBeanMethods = false)
public class FailureSupportConfiguration {

    /** {@code failureDelegate}: a {@link FailureDelegate} for {@code activiti:delegateExpression="${failureDelegate}"}. */
    @Bean
    public JavaDelegate failureDelegate() {
        return new FailureDelegate();
    }

    /** {@code attemptCounter}: see {@link AttemptCounter}. */
    @Bean
    public AttemptCounter attemptCounter() {
        return new AttemptCounter();
    }

    /** {@code countingFailure}: see {@link CountingFailureDelegate}. */
    @Bean
    public JavaDelegate countingFailure(AttemptCounter attemptCounter) {
        return new CountingFailureDelegate(attemptCounter);
    }

    /** {@code countingFailureTaskListener}: see {@link CountingFailureTaskListener}. */
    @Bean
    public TaskListener countingFailureTaskListener(AttemptCounter attemptCounter) {
        return new CountingFailureTaskListener(attemptCounter);
    }
}
