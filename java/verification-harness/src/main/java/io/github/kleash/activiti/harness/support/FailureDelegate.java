package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.BpmnError;
import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.delegate.JavaDelegate;

/**
 * A delegate that fails on request, for the error and retry corpus (C08, C19). It is both an {@code activiti:class}
 * delegate and the bean {@code failureDelegate} (for {@code activiti:delegateExpression}); the engine injects the
 * {@code <activiti:field>} values before each call.
 *
 * <p>Fields (all expressions, evaluated per call; a blank or {@code null} value means "not requested"):
 * <ul>
 *   <li>{@code errorCode}: throws a {@link BpmnError} with this code;</li>
 *   <li>{@code exceptionClass}: otherwise throws a new instance of this {@link RuntimeException} class, built with the
 *       {@code String} constructor from {@code message};</li>
 *   <li>{@code message}: the message of the error or exception (default {@code failure requested}).</li>
 * </ul>
 * When nothing is requested the call succeeds and appends {@code "<task id>:passed"} to the list variable
 * {@code failureDelegateCalls}.
 */
public class FailureDelegate implements JavaDelegate {

    public static final String VARIABLE = "failureDelegateCalls";

    private Expression errorCode;
    private Expression exceptionClass;
    private Expression message;

    public void setErrorCode(Expression errorCode) {
        this.errorCode = errorCode;
    }

    public void setExceptionClass(Expression exceptionClass) {
        this.exceptionClass = exceptionClass;
    }

    public void setMessage(Expression message) {
        this.message = message;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String code = text(errorCode, execution);
        String type = text(exceptionClass, execution);
        String text = text(message, execution);
        if (text.isBlank()) {
            text = "failure requested";
        }
        if (!code.isBlank()) {
            throw new BpmnError(code.trim(), text);
        }
        if (!type.isBlank()) {
            throw instantiate(type.trim(), text);
        }
        CallLog.append(execution, VARIABLE, execution.getCurrentActivityId() + ":passed");
    }

    private static String text(Expression expression, DelegateExecution execution) {
        if (expression == null) {
            return "";
        }
        Object value = expression.getValue(execution);
        return value == null ? "" : String.valueOf(value);
    }

    private static RuntimeException instantiate(String className, String message) {
        try {
            return Class.forName(className).asSubclass(RuntimeException.class).getConstructor(String.class).newInstance(message);
        } catch (ReflectiveOperationException | ClassCastException e) {
            throw new IllegalArgumentException("FailureDelegate cannot build the exception '" + className
                    + "': it must be a RuntimeException with a String constructor", e);
        }
    }
}
