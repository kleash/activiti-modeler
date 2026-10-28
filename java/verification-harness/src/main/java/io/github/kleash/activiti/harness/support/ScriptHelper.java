package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.BpmnError;

/**
 * Bean {@code scriptHelper} for JUEL script tasks and expressions (docs/corpus-support.md), for example
 * {@code ${scriptHelper.fail('LIMIT_EXCEEDED')}} or {@code ${scriptHelper.upper(name)}}.
 */
public class ScriptHelper {

    /** @return the text in upper case */
    public String upper(String text) {
        return text == null ? null : text.toUpperCase(java.util.Locale.ROOT);
    }

    /** Always throws a {@link BpmnError} with this error code and the message {@code "raised by scriptHelper"}. */
    public void fail(String errorCode) {
        throw new BpmnError(errorCode, "raised by scriptHelper");
    }
}
