package io.github.kleash.activiti.rest.core.error;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import org.springframework.core.annotation.AliasFor;
import org.springframework.web.bind.annotation.RestController;

/**
 * Marks a controller as part of the runtime REST API: its errors are answered as {@code application/problem+json} by the
 * {@link RestExceptionHandler}. The core controllers, the dev controllers and the modeler server's controllers carry it.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
@RestController
public @interface RuntimeRestController {

    /** The bean name; see {@link RestController#value()}. */
    @AliasFor(annotation = RestController.class, attribute = "value")
    String value() default "";
}
