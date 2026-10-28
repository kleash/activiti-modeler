package io.github.kleash.activiti.rest.dev.workspace;

import org.springframework.http.HttpStatus;

/** A workspace request that cannot be served; carries the HTTP status it is answered with. */
public class WorkspaceException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final HttpStatus status;

    public WorkspaceException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus status() {
        return status;
    }
}
