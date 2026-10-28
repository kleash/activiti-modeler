package io.github.kleash.activiti.rest.core.security;

/** The three access levels of the REST API. The authorities behind them are configured with {@code activiti.rest.roles.*}. */
public enum Access {
    /** Look at definitions, instances, history, tasks and jobs. */
    READ,
    /** Act: start instances, work on tasks, send messages and signals, manage instances and jobs. */
    OPERATE,
    /** Everything, including operations that can change other people's work. */
    ADMIN
}
