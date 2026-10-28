package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import io.github.kleash.activiti.harness.context.DeployMode;
import io.github.kleash.activiti.harness.context.ProjectContext;
import io.github.kleash.activiti.harness.project.Project;
import io.github.kleash.activiti.harness.project.ProjectDiscovery;

/** Engine behaviour that makes a model undeployable, kept as named evidence for docs/engine-findings.md. */
class EngineTrapsTest {

    @TempDir Path dir;

    private static String model(String definitions, String eventDefinition) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn" targetNamespace="http://example.org/trap">
                  %s
                  <process id="trap" isExecutable="true">
                    <startEvent id="start"/>
                    <sequenceFlow id="f1" sourceRef="start" targetRef="wait"/>
                    <intermediateCatchEvent id="wait">%s</intermediateCatchEvent>
                    <sequenceFlow id="f2" sourceRef="wait" targetRef="end"/>
                    <endEvent id="end"/>
                  </process>
                </definitions>
                """.formatted(definitions, eventDefinition);
    }

    private Project project(String definitions, String eventDefinition) throws IOException {
        Files.createDirectories(dir.resolve("processes"));
        Files.writeString(dir.resolve("processes/trap.bpmn20.xml"), model(definitions, eventDefinition));
        return ProjectDiscovery.directory(dir).get(0);
    }

    /** Engine finding 28: BpmnModel.getSignal(null) dereferences the signal ref while any signal is declared. */
    @Test
    void aSignalExpressionNextToADeclaredSignalFailsToParseWithANullPointerException() throws IOException {
        Project project = project("<signal id=\"s\" name=\"s\"/>", "<signalEventDefinition activiti:signalExpression=\"${'go-'.concat(region)}\"/>");

        assertThatThrownBy(() -> ProjectContext.start(project, DeployMode.PROGRAMMATIC))
                .hasStackTraceContaining("Error parsing XML")
                .hasStackTraceContaining("NullPointerException: Cannot invoke \"String.equals(Object)\" because \"id\" is null");
    }

    @Test
    void theSameSignalExpressionDeploysWhenTheFileDeclaresNoSignal() throws IOException {
        Project project = project("", "<signalEventDefinition activiti:signalExpression=\"${'go-'.concat(region)}\"/>");

        try (ProjectContext context = ProjectContext.start(project, DeployMode.PROGRAMMATIC)) {
            assertThat(context.definitions()).extracting(d -> d.getKey()).containsExactly("trap");
        }
    }

    @Test
    void aSignalReferenceDeploysNextToADeclaredSignal() throws IOException {
        Project project = project("<signal id=\"s\" name=\"s\"/>", "<signalEventDefinition signalRef=\"s\"/>");

        try (ProjectContext context = ProjectContext.start(project, DeployMode.PROGRAMMATIC)) {
            assertThat(context.definitions()).extracting(d -> d.getKey()).containsExactly("trap");
        }
    }

    /** Engine finding 36: this EL has no string concatenation with + (EL 2.2), so names are built with concat(). */
    @Test
    void plusOnStringsIsArithmeticInThisExpressionLanguage() throws IOException {
        Project project = project("", "<signalEventDefinition activiti:signalExpression=\"${'go-' + region}\"/>");

        try (ProjectContext context = ProjectContext.start(project, DeployMode.PROGRAMMATIC)) {
            org.activiti.engine.RuntimeService runtime = context.bean(org.activiti.engine.RuntimeService.class);
            assertThatThrownBy(() -> runtime.startProcessInstanceByKey("trap", java.util.Map.of("region", "EU")))
                    .hasStackTraceContaining("Cannot coerce 'go-' of class java.lang.String to class java.lang.Double");
        }
    }

    /**
     * Engine finding C21.2: the converters of the user task and the service task read {@code activiti:extensionId} into a property; no
     * other converter keeps unknown attributes, so on every other activity the attribute is dropped from the parsed model and from
     * the exported XML. (The corpus seed can only carry it on the two tasks that know it; the modeler's moddle rejects it elsewhere.)
     */
    @Test
    void extensionIdIsKeptOnUserTasksAndServiceTasksOnly() {
        String xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn" targetNamespace="http://example.org/trap">
                  <process id="ids" isExecutable="true">
                    <startEvent id="start"/>
                    <userTask id="user" activiti:extensionId="ext-user"/>
                    <serviceTask id="service" activiti:expression="${1}" activiti:extensionId="ext-service"/>
                    <scriptTask id="script" scriptFormat="juel" activiti:extensionId="ext-script"><script>${1}</script></scriptTask>
                    <manualTask id="manual" activiti:extensionId="ext-manual"/>
                    <receiveTask id="receive" activiti:extensionId="ext-receive"/>
                    <callActivity id="call" calledElement="other" activiti:extensionId="ext-call"/>
                    <subProcess id="sub" activiti:extensionId="ext-sub"><startEvent id="subStart"/></subProcess>
                    <endEvent id="end"/>
                  </process>
                </definitions>
                """;
        org.activiti.bpmn.converter.BpmnXMLConverter converter = new org.activiti.bpmn.converter.BpmnXMLConverter();
        org.activiti.bpmn.model.BpmnModel model = converter.convertToBpmnModel(
                () -> new java.io.ByteArrayInputStream(xml.getBytes(java.nio.charset.StandardCharsets.UTF_8)), false, false);
        org.activiti.bpmn.model.Process process = model.getProcessById("ids");

        assertThat(((org.activiti.bpmn.model.UserTask) process.getFlowElement("user")).getExtensionId()).isEqualTo("ext-user");
        assertThat(((org.activiti.bpmn.model.ServiceTask) process.getFlowElement("service")).getExtensionId()).isEqualTo("ext-service");
        for (String id : java.util.List.of("script", "manual", "receive", "call", "sub")) {
            assertThat(process.getFlowElement(id).getAttributes()).as("extension attributes of " + id).isEmpty();
        }

        String exported = new String(converter.convertToXML(model), java.nio.charset.StandardCharsets.UTF_8);
        assertThat(exported).contains("extensionId=\"ext-user\"", "extensionId=\"ext-service\"")
                .doesNotContain("ext-script", "ext-manual", "ext-receive", "ext-call", "ext-sub");
    }

    /**
     * Engine finding C18.7: a text annotation and an association of a collaboration become global artifacts of the BpmnModel, which the
     * diagram check of the validator does not look at, so their shape and edge are DI_INVALID_REFERENCE warnings; in the process of the pool
     * they are not. bpmn-js keeps the annotations of a pool in the collaboration; the modeler's export writes them into the pool's process.
     */
    @Test
    void anAnnotationOfACollaborationIsInNoProcessAndItsDiagramIsAnInvalidReference() {
        String artifacts = "<textAnnotation id=\"note\"><text>a note</text></textAnnotation><association id=\"as_work_note\" sourceRef=\"work\" targetRef=\"note\"/>";
        org.activiti.bpmn.model.BpmnModel inCollaboration = parse(annotated(artifacts, ""));
        assertThat(inCollaboration.getGlobalArtifacts()).extracting(org.activiti.bpmn.model.BaseElement::getId).containsExactly("note", "as_work_note");
        assertThat(inCollaboration.getProcessById("pooled").getArtifacts()).isEmpty();
        assertThat(diagramWarnings(inCollaboration)).containsExactlyInAnyOrder(
                "DI_INVALID_REFERENCE: Invalid reference in diagram interchange definition: could not find note",
                "DI_INVALID_REFERENCE: Invalid reference in diagram interchange definition: could not find as_work_note");

        org.activiti.bpmn.model.BpmnModel inProcess = parse(annotated("", artifacts));
        assertThat(inProcess.getProcessById("pooled").getArtifacts()).extracting(org.activiti.bpmn.model.BaseElement::getId).containsExactly("note", "as_work_note");
        assertThat(diagramWarnings(inProcess)).isEmpty();
    }

    private static String annotated(String inCollaboration, String inProcess) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://example.org/trap">
                  <collaboration id="collab"><participant id="pool" processRef="pooled"/>%s</collaboration>
                  <process id="pooled" isExecutable="true">
                    <startEvent id="start"/><sequenceFlow id="f1" sourceRef="start" targetRef="work"/><task id="work"/><sequenceFlow id="f2" sourceRef="work" targetRef="end"/><endEvent id="end"/>
                    %s
                  </process>
                  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="collab">
                    <bpmndi:BPMNShape id="pool_di" bpmnElement="pool" isHorizontal="true"><dc:Bounds x="0" y="0" width="600" height="250"/></bpmndi:BPMNShape>
                    <bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="80" y="100" width="36" height="36"/></bpmndi:BPMNShape>
                    <bpmndi:BPMNShape id="work_di" bpmnElement="work"><dc:Bounds x="180" y="78" width="100" height="80"/></bpmndi:BPMNShape>
                    <bpmndi:BPMNShape id="end_di" bpmnElement="end"><dc:Bounds x="350" y="100" width="36" height="36"/></bpmndi:BPMNShape>
                    <bpmndi:BPMNShape id="note_di" bpmnElement="note"><dc:Bounds x="300" y="10" width="100" height="30"/></bpmndi:BPMNShape>
                    <bpmndi:BPMNEdge id="f1_di" bpmnElement="f1"><di:waypoint x="116" y="118"/><di:waypoint x="180" y="118"/></bpmndi:BPMNEdge>
                    <bpmndi:BPMNEdge id="f2_di" bpmnElement="f2"><di:waypoint x="280" y="118"/><di:waypoint x="350" y="118"/></bpmndi:BPMNEdge>
                    <bpmndi:BPMNEdge id="as_di" bpmnElement="as_work_note"><di:waypoint x="250" y="78"/><di:waypoint x="320" y="40"/></bpmndi:BPMNEdge>
                  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
                </definitions>
                """.formatted(inCollaboration, inProcess);
    }

    private static org.activiti.bpmn.model.BpmnModel parse(String xml) {
        return new org.activiti.bpmn.converter.BpmnXMLConverter().convertToBpmnModel(
                () -> new java.io.ByteArrayInputStream(xml.getBytes(java.nio.charset.StandardCharsets.UTF_8)), true, false);
    }

    private static java.util.List<String> diagramWarnings(org.activiti.bpmn.model.BpmnModel model) {
        return new org.activiti.validation.ProcessValidatorFactory().createDefaultProcessValidator().validate(model).stream()
                .filter(e -> e.getKey().startsWith("DI_")).map(e -> e.getKey() + ": " + e.getDefaultDescription()).toList();
    }
}
