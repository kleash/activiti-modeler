package io.github.kleash.activiti.rest.core.error;

import java.util.Optional;

import org.springframework.http.HttpStatus;

/**
 * Extension point of the error model: a module that throws its own exception types (the dev endpoints throw DMN and
 * workspace exceptions) maps them to a status and may add members to the problem document. Declare it as a bean.
 */
public interface ProblemMapping {

    /** @return the status for {@code failure}, or empty when this mapping does not know the exception */
    Optional<HttpStatus> statusOf(Throwable failure);

    /** Members to add to the {@code application/problem+json} document of {@code failure}; called only when {@link #statusOf} matched. */
    default java.util.Map<String, Object> extensionsOf(Throwable failure) {
        return java.util.Map.of();
    }
}
