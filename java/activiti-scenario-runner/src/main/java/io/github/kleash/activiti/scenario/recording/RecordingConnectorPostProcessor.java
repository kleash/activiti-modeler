package io.github.kleash.activiti.scenario.recording;

import org.activiti.api.process.runtime.connector.Connector;
import org.springframework.beans.factory.config.BeanPostProcessor;

/**
 * Wraps every {@link Connector} bean in a {@link RecordingConnector}. Register it as a static {@code @Bean} method so
 * that it is in place before any connector is created.
 */
public final class RecordingConnectorPostProcessor implements BeanPostProcessor {

    private final ConnectorCallRecorder recorder;

    public RecordingConnectorPostProcessor(ConnectorCallRecorder recorder) {
        this.recorder = recorder;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (bean instanceof Connector connector && !(bean instanceof RecordingConnector)) {
            return new RecordingConnector(beanName, connector, recorder);
        }
        return bean;
    }
}
