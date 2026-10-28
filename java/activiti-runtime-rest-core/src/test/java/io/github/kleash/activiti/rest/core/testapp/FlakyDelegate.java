package io.github.kleash.activiti.rest.core.testapp;

import java.util.concurrent.atomic.AtomicBoolean;

import org.activiti.engine.delegate.DelegateExecution;
import org.activiti.engine.delegate.JavaDelegate;

/** A service task implementation that fails while {@link #FAIL} is set. */
public class FlakyDelegate implements JavaDelegate {

    public static final AtomicBoolean FAIL = new AtomicBoolean(true);

    @Override
    public void execute(DelegateExecution execution) {
        if (FAIL.get()) {
            throw new IllegalStateException("flaky call failed");
        }
        execution.setVariable("flakyDone", true);
    }
}
