package io.github.kleash.activiti.rest.core.testapp;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import org.activiti.engine.RepositoryService;
import org.activiti.engine.repository.Deployment;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Deploys the BPMN fixtures of the tests as one deployment. */
@Component
public class Fixtures {

    public static final String DEPLOYMENT_NAME = "rest-fixtures";
    private static final List<String> FILES = List.of("rest-review.bpmn20.xml", "rest-review-extensions.json", "rest-waits.bpmn20.xml",
            "rest-flaky.bpmn20.xml", "rest-call.bpmn20.xml", "rest-misc.bpmn20.xml");

    @Autowired private RepositoryService repository;

    /** Deploys the fixtures unless a deployment with that name exists; returns its id. */
    public synchronized String deploy() {
        Deployment existing = repository.createDeploymentQuery().deploymentName(DEPLOYMENT_NAME).singleResult();
        if (existing != null) {
            return existing.getId();
        }
        var builder = repository.createDeployment().name(DEPLOYMENT_NAME);
        for (String file : FILES) {
            try (InputStream in = Fixtures.class.getResourceAsStream("/fixtures/" + file)) {
                builder.addString(file, new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        }
        return builder.deploy().getId();
    }
}
