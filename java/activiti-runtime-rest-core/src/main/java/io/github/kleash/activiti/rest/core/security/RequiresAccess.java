package io.github.kleash.activiti.rest.core.security;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares the access level an endpoint needs. The library enforces it with an interceptor that compares the granted
 * authorities of the authenticated principal with the configured authorities of the level
 * ({@code activiti.rest.roles.read|operate|admin}); who may authenticate at all is the host application's business.
 * Without an authenticated principal the answer is 401, with the wrong authorities 403.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface RequiresAccess {

    /** The level required. */
    Access value();
}
