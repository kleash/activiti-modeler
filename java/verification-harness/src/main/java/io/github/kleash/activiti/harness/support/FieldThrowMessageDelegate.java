package io.github.kleash.activiti.harness.support;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.Expression;
import org.activiti.engine.impl.delegate.ThrowMessage;
import org.activiti.engine.impl.delegate.ThrowMessageDelegate;

/**
 * Throw-message delegate for {@code messageEventDefinition activiti:class="...FieldThrowMessageDelegate"} that has a
 * field {@code tag} (an expression). It appends {@code "<tag or [unset]>:<message name>"} to the process variable
 * {@code fieldThrows}. The engine builds throw delegates without field declarations, so the field stays
 * {@code null} even when the message event definition has {@code <activiti:field name="tag">} children (see
 * docs/engine-findings.md); the delegate records that. It returns {@code true}.
 */
public class FieldThrowMessageDelegate implements ThrowMessageDelegate {

    public static final String VARIABLE = "fieldThrows";

    private Expression tag;

    public void setTag(Expression tag) {
        this.tag = tag;
    }

    @Override
    public boolean send(DelegateExecution execution, ThrowMessage message) {
        String value = tag == null ? "[unset]" : String.valueOf(tag.getValue(execution));
        CallLog.append(execution, VARIABLE, value + ":" + message.getName());
        return true;
    }
}
