package io.github.kleash.activiti.dmn;

/**
 * Base class of every error raised by the DMN connector. All of them are unchecked so that a failing decision task
 * fails the Activiti command (and rolls it back) like any other service task exception.
 */
public class DmnException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * Creates an exception.
     *
     * @param message what went wrong, written for the model author
     */
    public DmnException(String message) {
        super(message);
    }

    /**
     * Creates an exception with a cause.
     *
     * @param message what went wrong, written for the model author
     * @param cause   the underlying engine error
     */
    public DmnException(String message, Throwable cause) {
        super(message, cause);
    }
}
