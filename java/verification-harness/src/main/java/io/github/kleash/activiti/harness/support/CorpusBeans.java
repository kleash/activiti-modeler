package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.ExecutionListener;
import org.activiti.engine.delegate.JavaDelegate;
import org.activiti.engine.delegate.TaskListener;
import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.engine.impl.delegate.ThrowMessageDelegate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Beans for {@code activiti:delegateExpression="${...}"} and listener expressions (docs/corpus-support.md). */
@Configuration(proxyBeanMethods = false)
public class CorpusBeans {

    /**
     * {@code recordingDelegate}: appends the id of the service task it runs for to the process variable
     * {@code delegateCalls} and sets {@code lastDelegate} to it.
     */
    @Bean
    public JavaDelegate recordingDelegate() {
        return execution -> {
            String activity = execution.getCurrentActivityId();
            CallLog.append(execution, "delegateCalls", activity);
            execution.setVariable("lastDelegate", activity);
        };
    }

    /**
     * {@code setVariableDelegate}: a {@link SetVariableDelegate} as a bean, for {@code activiti:delegateExpression}
     * with {@code <activiti:field>} elements (the engine injects the fields into the bean before every call).
     */
    @Bean
    public JavaDelegate setVariableDelegate() {
        return new SetVariableDelegate();
    }

    /** {@code greeter}: see {@link Greeter}. */
    @Bean
    public Greeter greeter() {
        return new Greeter();
    }

    /** {@code recordingExecutionListener}: see {@link RecordingExecutionListener}. */
    @Bean
    public ExecutionListener recordingExecutionListener() {
        return new RecordingExecutionListener();
    }

    /** {@code recordingTaskListener}: see {@link RecordingTaskListener}. */
    @Bean
    public TaskListener recordingTaskListener() {
        return new RecordingTaskListener();
    }

    /** {@code recordingEventListener}: see {@link RecordingEventListener}. */
    @Bean
    public ActivitiEventListener recordingEventListener() {
        return new RecordingEventListener();
    }

    /** {@code recordingThrowMessageDelegate}: see {@link RecordingThrowMessageDelegate}. */
    @Bean
    public ThrowMessageDelegate recordingThrowMessageDelegate() {
        return new RecordingThrowMessageDelegate();
    }
}
