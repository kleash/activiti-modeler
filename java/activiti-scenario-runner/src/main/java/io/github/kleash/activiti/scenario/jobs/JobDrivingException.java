package io.github.kleash.activiti.scenario.jobs;

/** A job could not be driven as requested (not found, failed unexpectedly, did not settle in time). */
public class JobDrivingException extends RuntimeException {

    public JobDrivingException(String message) {
        super(message);
    }

    public JobDrivingException(String message, Throwable cause) {
        super(message, cause);
    }
}
