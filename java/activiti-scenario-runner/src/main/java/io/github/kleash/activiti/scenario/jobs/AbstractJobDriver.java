package io.github.kleash.activiti.scenario.jobs;

/** Base of the drivers: the shared job queries and failure rendering. */
abstract class AbstractJobDriver implements JobDriver {

    protected final JobSupport jobs;

    protected AbstractJobDriver(JobSupport jobs) {
        this.jobs = jobs;
    }

    /** Class and message of the failure and its causes, for reports. */
    protected static String describe(Throwable t) {
        StringBuilder sb = new StringBuilder();
        int depth = 0;
        for (Throwable c = t; c != null && depth < 6; c = c.getCause() == c ? null : c.getCause(), depth++) {
            if (sb.length() > 0) {
                sb.append(" <- ");
            }
            sb.append(c.getClass().getSimpleName()).append(": ").append(c.getMessage());
        }
        return sb.toString();
    }
}
