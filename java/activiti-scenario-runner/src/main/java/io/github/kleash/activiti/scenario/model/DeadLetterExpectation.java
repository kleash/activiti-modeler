package io.github.kleash.activiti.scenario.model;

/** One expected dead-letter job. */
public record DeadLetterExpectation(String activity, String exceptionMessageContains) {
}
