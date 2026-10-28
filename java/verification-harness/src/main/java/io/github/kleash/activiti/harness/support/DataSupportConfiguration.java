package io.github.kleash.activiti.harness.support;

import org.activiti.spring.process.ProcessExtensionService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Beans of the data corpus (C15); documented in docs/corpus-support.md. */
@Configuration(proxyBeanMethods = false)
public class DataSupportConfiguration {

    /** {@code extensionInspector}: see {@link ExtensionInspector}. */
    @Bean
    public ExtensionInspector extensionInspector(ProcessExtensionService extensions) {
        return new ExtensionInspector(extensions);
    }
}
