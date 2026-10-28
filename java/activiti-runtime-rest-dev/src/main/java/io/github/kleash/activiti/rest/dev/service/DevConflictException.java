package io.github.kleash.activiti.rest.dev.service;

/** The request is fine but cannot be served now (another scenario run is in progress). Answered with 409. */
public class DevConflictException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public DevConflictException(String message) {
        super(message);
    }
}
