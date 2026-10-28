package io.github.kleash.activiti.dmn;

/**
 * A decision reference could not be resolved to exactly one decision: nothing matched, or a resolution step
 * (resource base name, {@code definitions/@name}, decision id) matched more than one candidate.
 */
public class DmnResolutionException extends DmnException {

    private static final long serialVersionUID = 1L;

    /**
     * Creates an exception.
     *
     * @param message the reference, the step that failed and the candidates
     */
    public DmnResolutionException(String message) {
        super(message);
    }
}
