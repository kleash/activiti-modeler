package io.github.kleash.activiti.rest.core.dto;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a request body type whose JSON must not contain fields the type does not declare. The application's object mapper ignores
 * unknown fields (Spring Boot's default); for the REST API that would silently swallow {@code "user": "bob"} in a body, so these types
 * are checked by {@code StrictRequestBodyAdvice} and refused with 400.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface StrictBody {
}
