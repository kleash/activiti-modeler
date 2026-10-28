package io.github.kleash.activiti.harness.support;

import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;

/**
 * Entry point of the corpus support library (documented in docs/corpus-support.md): connector beans, delegates, listeners.
 *
 * <p>The support is pluggable: this configuration scans its own package, so a {@code @Configuration} or
 * {@code @Component} added to {@code io.github.kleash.activiti.harness.support} (for example a GreenMail mail
 * server for the mail corpus) is part of every project context without any wiring. Configurations outside the
 * package can be added with {@code -Dharness.extra-config=<fully.qualified.Class>[,...]}.
 */
@Configuration(proxyBeanMethods = false)
@ComponentScan(basePackageClasses = CorpusSupportConfiguration.class)
public class CorpusSupportConfiguration {
}
