package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.CustomPropertiesResolver;
import org.activiti.engine.delegate.ExecutionListener;
import org.activiti.engine.delegate.TransactionDependentExecutionListener;
import org.activiti.engine.delegate.TransactionDependentTaskListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Beans of the listener corpus (C13); documented in docs/corpus-support.md. */
@Configuration(proxyBeanMethods = false)
public class ListenerSupportConfiguration {

    /** {@code fieldExecutionListener}: a {@link FieldExecutionListener} for {@code delegateExpression} with fields. */
    @Bean
    public ExecutionListener fieldExecutionListener() {
        return new FieldExecutionListener();
    }

    /** {@code endGuard}: see {@link EndGuardListener}. */
    @Bean
    public EndGuardListener endGuard() {
        return new EndGuardListener();
    }

    /** {@code listenerRecorder}: see {@link ListenerRecorder}. */
    @Bean
    public ListenerRecorder listenerRecorder() {
        return new ListenerRecorder();
    }

    /** {@code transactionLog}: see {@link TransactionListenerLog}. */
    @Bean
    public TransactionListenerLog transactionLog() {
        return new TransactionListenerLog();
    }

    /** {@code beforeCommitExecutionListener}: records phase {@code before-commit}. */
    @Bean
    public TransactionDependentExecutionListener beforeCommitExecutionListener(TransactionListenerLog log) {
        return new RecordingTransactionListeners.ExecutionPhase("before-commit", log);
    }

    /** {@code committedExecutionListener}: records phase {@code committed}. */
    @Bean
    public TransactionDependentExecutionListener committedExecutionListener(TransactionListenerLog log) {
        return new RecordingTransactionListeners.ExecutionPhase("committed", log);
    }

    /** {@code rolledBackExecutionListener}: records phase {@code rolled-back}. */
    @Bean
    public TransactionDependentExecutionListener rolledBackExecutionListener(TransactionListenerLog log) {
        return new RecordingTransactionListeners.ExecutionPhase("rolled-back", log);
    }

    /** {@code beforeCommitTaskListener}: records phase {@code before-commit}. */
    @Bean
    public TransactionDependentTaskListener beforeCommitTaskListener(TransactionListenerLog log) {
        return new RecordingTransactionListeners.TaskPhase("before-commit", log);
    }

    /** {@code committedTaskListener}: records phase {@code committed}. */
    @Bean
    public TransactionDependentTaskListener committedTaskListener(TransactionListenerLog log) {
        return new RecordingTransactionListeners.TaskPhase("committed", log);
    }

    /** {@code rolledBackTaskListener}: records phase {@code rolled-back}. */
    @Bean
    public TransactionDependentTaskListener rolledBackTaskListener(TransactionListenerLog log) {
        return new RecordingTransactionListeners.TaskPhase("rolled-back", log);
    }

    /** {@code delegatePropertiesResolver}: custom properties resolver with {@code resolvedBy=delegateExpression}. */
    @Bean
    public CustomPropertiesResolver delegatePropertiesResolver() {
        return new CorpusPropertiesResolver("delegateExpression");
    }

    /** {@code propertiesFactory}: see {@link CorpusPropertiesResolver.Factory}. */
    @Bean
    public CorpusPropertiesResolver.Factory propertiesFactory() {
        return new CorpusPropertiesResolver.Factory();
    }
}
