package io.github.kleash.activiti.rest.dev.web;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.HttpStatus;

import io.github.kleash.activiti.dmn.DmnException;
import io.github.kleash.activiti.dmn.DmnModelException;
import io.github.kleash.activiti.dmn.DmnResolutionException;
import io.github.kleash.activiti.rest.core.error.ProblemMapping;
import io.github.kleash.activiti.rest.dev.service.DevConflictException;
import io.github.kleash.activiti.rest.dev.service.DevValidationException;
import io.github.kleash.activiti.rest.dev.workspace.WorkspaceException;
import io.github.kleash.activiti.scenario.jobs.JobDrivingException;
import io.github.kleash.activiti.scenario.load.InvalidScenarioException;

/** Maps the exceptions of the dev endpoints to statuses; validation findings go into the problem document as {@code problems}. */
public class DevProblemMapping implements ProblemMapping {

    @Override
    public Optional<HttpStatus> statusOf(Throwable failure) {
        if (failure instanceof DevValidationException) {
            return Optional.of(HttpStatus.UNPROCESSABLE_ENTITY);
        }
        if (failure instanceof DevConflictException) {
            return Optional.of(HttpStatus.CONFLICT);
        }
        if (failure instanceof WorkspaceException workspace) {
            return Optional.of(workspace.status());
        }
        if (failure instanceof InvalidScenarioException) {
            return Optional.of(HttpStatus.BAD_REQUEST);
        }
        if (failure instanceof DmnResolutionException) {
            return Optional.of(HttpStatus.NOT_FOUND);
        }
        if (failure instanceof DmnModelException || failure instanceof DmnException || failure instanceof JobDrivingException) {
            return Optional.of(HttpStatus.UNPROCESSABLE_ENTITY);
        }
        return Optional.empty();
    }

    @Override
    public Map<String, Object> extensionsOf(Throwable failure) {
        if (failure instanceof DevValidationException validation) {
            return Map.of("problems", validation.problems());
        }
        if (failure instanceof InvalidScenarioException scenario) {
            return Map.of("problems", List.copyOf(scenario.problems()));
        }
        return Map.of();
    }
}
