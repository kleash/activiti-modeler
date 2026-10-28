package io.github.kleash.activiti.dmn;

/**
 * The DMN document cannot be read, is invalid, or uses a construct the selected engine cannot execute
 * (for example a business knowledge model on the Operaton engine).
 */
public class DmnModelException extends DmnException {

    private static final long serialVersionUID = 1L;

    /**
     * Creates an exception.
     *
     * @param message what is wrong with the model
     */
    public DmnModelException(String message) {
        super(message);
    }

    /**
     * Creates an exception with a cause.
     *
     * @param message what is wrong with the model
     * @param cause   the underlying parser error
     */
    public DmnModelException(String message, Throwable cause) {
        super(message, cause);
    }
}
