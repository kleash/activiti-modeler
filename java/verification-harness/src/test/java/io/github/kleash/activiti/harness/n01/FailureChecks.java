package io.github.kleash.activiti.harness.n01;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;

import org.activiti.api.process.model.builders.MessagePayloadBuilder;
import org.activiti.api.process.runtime.ProcessRuntime;
import org.activiti.engine.delegate.JavaDelegate;
import org.activiti.engine.runtime.ProcessInstance;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * Models that deploy and then throw: the start or the next step fails and the whole call is rolled back. Every check also asserts
 * the rollback: no instance and no history are left.
 */
final class FailureChecks {

    private FailureChecks() {
    }

    static void register(Map<String, N01Check> checks) {
        N01Checks.put(checks, "cancel-end-without-compensation-fails", FailureChecks::cancelEndFails);
        N01Checks.put(checks, "call-of-an-invalid-key-fails", FailureChecks::callOfInvalidKeyFails);
        N01Checks.put(checks, "call-of-an-unknown-process-fails", FailureChecks::callOfUnknownProcessFails);
        N01Checks.put(checks, "unknown-connector-bean-fails", FailureChecks::unknownConnectorFails);
        N01Checks.put(checks, "groovy-script-fails", FailureChecks::groovyFails);
        N01Checks.put(checks, "unknown-property-type-fails-at-start", FailureChecks::unknownPropertyTypeFails);
        N01Checks.put(checks, "process-end-listener-cannot-set-a-variable", FailureChecks::endListenerCannotSetVariable);
        N01Checks.put(checks, "string-plus-fails-at-start", FailureChecks::stringPlusFails);
        N01Checks.put(checks, "map-exception-on-a-delegate-expression-is-ignored", FailureChecks::mapExceptionIsParsedOnly);
        N01Checks.put(checks, "map-exception-does-not-catch-a-bean-exception", FailureChecks::mapExceptionDoesNotCatch);
        N01Checks.put(checks, "message-clash-needs-a-wait-state", FailureChecks::messageClashNeedsAWaitState);
        N01Checks.put(checks, "message-clash-makes-receive-fail", FailureChecks::messageClashMakesReceiveFail);
        N01Checks.put(checks, "web-service-task-without-operation-fails", FailureChecks::webServiceWithoutOperationFails);
        N01Checks.put(checks, "web-service-task-needs-the-cxf-importer", FailureChecks::webServiceNeedsCxfImporter);
    }

    /** The start fails with all of the fragments in the exception chain, and nothing of the instance is left. */
    private static void startFails(N01Engine e, String key, Map<String, Object> variables, String... fragments) {
        assertThatThrownBy(() -> e.start(key, variables)).satisfies(t -> assertThat(N01Engine.chain(t)).contains(fragments));
        assertRolledBack(e, key);
    }

    private static void assertRolledBack(N01Engine e, String key) {
        assertThat(e.instancesOf(key)).as("the call was rolled back: no instance").isEmpty();
        assertThat(e.history.createHistoricProcessInstanceQuery().processDefinitionKey(key).count()).as("and no history").isZero();
    }

    // ---- constructs that throw ------------------------------------------------------------------------------------------------

    private static void cancelEndFails(N01Engine e) {
        // the plain task before the cancel end is a pass-through, so the failure comes with the start
        startFails(e, "cancelNoComp", Map.of(), "ActivitiException", "No execution found for sub process of boundary cancel event cancelled");
    }

    private static void callOfInvalidKeyFails(N01Engine e) {
        startFails(e, "callInvalid", Map.of(), "ActivitiObjectNotFoundException: no processes deployed with key 'my child'");
    }

    private static void callOfUnknownProcessFails(N01Engine e) {
        assertThat(e.definition("otherProcess")).as("the project does have a process, just not the one that is called").isNotNull();
        startFails(e, "callUnknown", Map.of(), "ActivitiObjectNotFoundException: no processes deployed with key 'ghostProcess'");
    }

    private static void unknownConnectorFails(N01Engine e) {
        startFails(e, "connectorUnknown", Map.of(), "NoSuchBeanDefinitionException: No bean named 'mailer.SEND' available");
    }

    private static void groovyFails(N01Engine e) {
        startFails(e, "groovyScript", Map.of(), "ActivitiException: Can't find scripting engine for 'groovy'");
    }

    private static void unknownPropertyTypeFails(N01Engine e) {
        startFails(e, "badProperty", Map.of(), "NullPointerException", "VariableType.parseFromValue(Object)", "\"type\" is null");
    }

    private static void endListenerCannotSetVariable(N01Engine e) {
        // work is a plain task: the failure comes with the start
        startFails(e, "endListener", Map.of(), "PersistenceException", "Referential integrity constraint violation", "ACT_FK_VAR_EXE");
    }

    private static void stringPlusFails(N01Engine e) {
        startFails(e, "stringPlus", Map.of("region", "EU"), "Error while evaluating expression: ${'go-' + region}", "ELException: Cannot coerce 'go-' of class java.lang.String to class java.lang.Double");
    }

    // ---- mapException on a delegate expression: parsed, never wired ---------------------------------------------------------------

    private static void mapExceptionIsParsedOnly(N01Engine e) {
        org.activiti.bpmn.model.ServiceTask task = (org.activiti.bpmn.model.ServiceTask) e.element("mapExceptionBean", "call");
        assertThat(task.getMapExceptions()).as("the mapping is parsed into the model").hasSize(1);
        assertThat(task.getMapExceptions().get(0).getErrorCode()).isEqualTo("E1");
        assertThat(task.getMapExceptions().get(0).getClassName()).isEqualTo("java.lang.IllegalStateException");

        ProcessInstance instance = e.start("mapExceptionBean");
        assertThat(e.ended(instance.getId())).as("the recording delegate does not throw: the model runs through").isTrue();
        assertThat(e.variables(instance.getId())).containsEntry("lastDelegate", "call");
    }

    /** Variant: the delegate bean is replaced by one that throws an {@code IllegalStateException}. */
    private static void mapExceptionDoesNotCatch(N01Engine e) {
        ((ConfigurableApplicationContext) e.context.spring()).getBeanFactory().registerSingleton("throwingDelegate", (JavaDelegate) execution -> {
            throw new IllegalStateException("boom from the bean");
        });

        assertThatThrownBy(() -> e.start("mapExceptionBean")).satisfies(t -> {
            String chain = N01Engine.chain(t);
            assertThat(chain).as("the Java exception comes out, wrapped").contains("IllegalStateException: boom from the bean");
            assertThat(chain).as("it was not turned into the BPMN error E1").doesNotContain("No catching boundary event found", "E1");
        });
        assertRolledBack(e, "mapExceptionBean");
    }

    // ---- two subscriptions of one message -------------------------------------------------------------------------------------------

    private static void messageClashNeedsAWaitState(N01Engine e) {
        ProcessInstance instance = e.start("messageClash");
        assertThat(e.ended(instance.getId())).as("work is a pass-through task: the instance ends at once, no subscription ever coexists").isTrue();
        assertThat(e.subscriptionsOf(instance.getId())).isEmpty();
    }

    /** Variant: {@code work} is a user task, so that the boundary event and the event sub process are subscribed together. */
    private static void messageClashMakesReceiveFail(N01Engine e) {
        ProcessInstance instance = e.start("messageClash");
        assertThat(e.subscriptionsOf(instance.getId())).as("two subscriptions of the message at once")
                .containsExactlyInAnyOrder("message:docs@docsBoundary", "message:docs@docsStart");

        ProcessRuntime processRuntime = e.context.bean(ProcessRuntime.class);
        assertThatThrownBy(() -> e.runAsUser("n01", List.of(), () -> processRuntime.receive(MessagePayloadBuilder.receive("docs").build())))
                .hasStackTraceContaining("Query return 2 results instead of max 1");

        assertThat(e.subscriptionsOf(instance.getId())).as("nothing was delivered").hasSize(2);
        assertThat(e.waitingAt(instance.getId())).contains("work");
    }

    // ---- web service task ---------------------------------------------------------------------------------------------------------

    private static void webServiceWithoutOperationFails(N01Engine e) {
        assertThat(((org.activiti.bpmn.model.ServiceTask) e.element("webService", "call")).getImplementation()).as("the converter keeps no implementation name").isNull();
        // without an operationRef the parse handler falls back to the default service task behaviour, which looks up a connector bean
        // by the task's implementation, and the converter leaves that null for ##WebService
        startFails(e, "webService", Map.of(), "IllegalArgumentException: 'name' must not be null");
    }

    /** Variant with an import, an interface, an operation and an operationRef: it deploys, and the importer is loaded when the task runs. */
    private static void webServiceNeedsCxfImporter(N01Engine e) {
        org.activiti.bpmn.model.ServiceTask task = (org.activiti.bpmn.model.ServiceTask) e.element("webServiceWsdl", "call");
        assertThat(task.getOperationRef()).endsWith("incOperation");
        assertThat(task.getBehavior()).as("a real web service behaviour this time")
                .isInstanceOf(org.activiti.engine.impl.bpmn.behavior.WebServiceActivityBehavior.class);
        assertThatThrownBy(() -> Class.forName("org.activiti.engine.impl.webservice.CxfWSDLImporter")).as("the importer class is in no jar of the class path")
                .isInstanceOf(ClassNotFoundException.class);

        startFails(e, "webServiceWsdl", Map.of(), "ActivitiException: Could not find importer for type http://schemas.xmlsoap.org/wsdl/");
    }
}
