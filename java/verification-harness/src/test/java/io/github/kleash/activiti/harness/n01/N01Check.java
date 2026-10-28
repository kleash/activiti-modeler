package io.github.kleash.activiti.harness.n01;

/** The assertions about what the engine does with one deployed N01 model. Named in the oracle by its id. */
@FunctionalInterface
interface N01Check {

    void run(N01Engine engine) throws Exception;
}
