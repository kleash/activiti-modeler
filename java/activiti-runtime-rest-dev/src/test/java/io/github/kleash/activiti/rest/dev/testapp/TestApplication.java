package io.github.kleash.activiti.rest.dev.testapp;

import org.springframework.boot.autoconfigure.SpringBootApplication;

/** A host application: embedded Activiti, the core REST API, the dev endpoints, the DMN connector and the scenario runner. */
@SpringBootApplication
public class TestApplication {

    /** An asynchronous task that takes 1.5 seconds (the scenario lock test needs a run that lasts). */
    @org.springframework.context.annotation.Bean
    public org.activiti.engine.delegate.JavaDelegate slowDelegate() {
        return execution -> {
            try {
                Thread.sleep(1500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
    }
}
