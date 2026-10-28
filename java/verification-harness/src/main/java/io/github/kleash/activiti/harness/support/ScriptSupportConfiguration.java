package io.github.kleash.activiti.harness.support;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Beans for script tasks (C03, docs/corpus-support.md): {@code scriptHelper}. */
@Configuration(proxyBeanMethods = false)
public class ScriptSupportConfiguration {

    /** {@code scriptHelper}: see {@link ScriptHelper}. */
    @Bean
    public ScriptHelper scriptHelper() {
        return new ScriptHelper();
    }
}
