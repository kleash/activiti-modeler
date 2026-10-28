package io.github.kleash.activiti.scenario.testapp;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.activiti.api.process.runtime.connector.Connector;
import org.activiti.engine.delegate.JavaDelegate;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

import io.github.kleash.activiti.scenario.run.DecisionEvaluator;

/** Host application of the runner's integration tests: embedded Activiti with the models under src/test/resources/processes. */
@SpringBootApplication
public class TestApplication {

    public static void main(String[] args) {
        SpringApplication.run(TestApplication.class, args);
    }

    /** Connector with a dotted bean name, as used for {@code implementation="crm.LOOKUP"}. */
    @Bean(name = "crm.LOOKUP")
    public Connector crmLookup() {
        return context -> {
            String customerId = context.getInBoundVariable("customerId");
            context.addOutBoundVariable("name", "Customer " + customerId);
            context.addOutBoundVariable("risk", customerId != null && customerId.startsWith("VIP") ? "low" : "normal");
            return context;
        };
    }

    @Bean
    public JavaDelegate failingDelegate() {
        return execution -> {
            throw new IllegalStateException("boom");
        };
    }

    @Bean
    public JavaDelegate okDelegate() {
        return execution -> execution.setVariable("done", true);
    }

    private final java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicInteger> attempts = new java.util.concurrent.ConcurrentHashMap<>();

    /** Fails on the first attempt per process instance, works afterwards; records the number of attempts in {@code attempts}. */
    @Bean
    public JavaDelegate failOnceDelegate() {
        return execution -> {
            int attempt = attempts.computeIfAbsent("once:" + execution.getProcessInstanceId(), k -> new java.util.concurrent.atomic.AtomicInteger()).incrementAndGet();
            if (attempt == 1) {
                throw new IllegalStateException("first attempt fails");
            }
            execution.setVariable("attempts", attempt);
        };
    }

    /** Fails on the first attempt per process instance with the optimistic locking failure of a lost job race. */
    @Bean
    public JavaDelegate lockFailOnceDelegate() {
        return execution -> {
            int attempt = attempts.computeIfAbsent("lock:" + execution.getProcessInstanceId(), k -> new java.util.concurrent.atomic.AtomicInteger()).incrementAndGet();
            if (attempt == 1) {
                throw new org.activiti.engine.ActivitiOptimisticLockingException("JobEntity [id=test] was updated by another transaction concurrently");
            }
            execution.setVariable("attempts", attempt);
        };
    }

    /** Increments the process variable {@code n}. */
    @Bean
    public JavaDelegate counterDelegate() {
        return execution -> {
            Object n = execution.getVariable("n");
            execution.setVariable("n", (n == null ? 0 : ((Number) n).intValue()) + 1);
        };
    }

    /** A tiny decision table: orders of 1000 or more are "high" (rule R2), the others "low" (rule R1). */
    @Bean
    public DecisionEvaluator decisionEvaluator() {
        return (decision, inputs) -> {
            if (!"riskLevel".equals(decision)) {
                throw new IllegalArgumentException("unknown decision " + decision);
            }
            int amount = ((Number) inputs.get("amount")).intValue();
            List<Map<String, Object>> rows = new ArrayList<>();
            rows.add(Map.of("riskLevel", amount >= 1000 ? "high" : "low"));
            return new DecisionEvaluator.Outcome(rows, List.of(amount >= 1000 ? "R2" : "R1"));
        };
    }
}
