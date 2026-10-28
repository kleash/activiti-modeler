package io.github.kleash.activiti.harness.support;

/**
 * Bean {@code greeter} for expressions such as {@code ${greeter.greet(customerName)}} (docs/corpus-support.md).
 */
public class Greeter {

    /** @return {@code "Hello, <name>"} */
    public String greet(String name) {
        return "Hello, " + name;
    }

    /** @return the sum of both numbers as a long */
    public long add(Number a, Number b) {
        return a.longValue() + b.longValue();
    }
}
