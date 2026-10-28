package io.github.kleash.activiti.modeler.shell;

import java.util.ArrayList;
import java.util.List;

import org.activiti.bpmn.model.BpmnModel;
import org.activiti.bpmn.model.FlowElement;
import org.activiti.bpmn.model.Process;
import org.activiti.bpmn.model.ServiceTask;
import org.activiti.spring.SpringProcessEngineConfiguration;
import org.activiti.spring.boot.ProcessEngineConfigurationConfigurer;
import org.activiti.validation.ProcessValidator;
import org.activiti.validation.ProcessValidatorFactory;
import org.activiti.validation.ProcessValidatorImpl;
import org.activiti.validation.ValidationError;
import org.activiti.validation.validator.ValidatorSet;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.github.kleash.activiti.modeler.ModelerServerProperties;

/**
 * Shell tasks ({@code activiti:type="shell"}) run commands on this machine. A modeler that deploys what the user draws should not do
 * that by default, so unless {@code modeler.server.allow-shell-tasks=true} the engine's process validation gets one more rule
 * that makes a model with a shell task an error. Because it is part of the engine's validator, it holds for every way a model reaches
 * the engine: the dev endpoints (validate, deploy, scenario run), a deployment from the classpath, a programmatic deployment.
 *
 * <p>The rule is not an Activiti {@code Validator} in a {@code ValidatorSet}: the engine decorates every problem of those with a message
 * from a fixed catalogue and fails on a key it does not know. The policy is a subclass of the engine's validator that adds its own error.
 */
@Configuration(proxyBeanMethods = false)
public class ShellTaskPolicy {

    /** The key of the problem. */
    public static final String PROBLEM = "modeler-shell-task-not-allowed";

    /** The name of the validator set the problem is reported under. */
    public static final String VALIDATOR_SET = "modeler-server";

    @Bean
    public ProcessEngineConfigurationConfigurer shellTaskPolicyConfigurer(ModelerServerProperties properties) {
        return (SpringProcessEngineConfiguration configuration) -> {
            if (properties.isAllowShellTasks()) {
                return;
            }
            ProcessValidator existing = configuration.getProcessValidator();
            ProcessValidator base = existing != null ? existing : new ProcessValidatorFactory().createDefaultProcessValidator();
            NoShellTasksValidator validator = new NoShellTasksValidator();
            validator.setValidatorSets(new ArrayList<>(base.getValidatorSets()));
            configuration.setProcessValidator(validator);
        };
    }

    /** The engine's validation, plus an error for every service task of type {@code shell}. */
    static final class NoShellTasksValidator extends ProcessValidatorImpl {

        @Override
        public List<ValidationError> validate(BpmnModel bpmnModel) {
            List<ValidationError> errors = new ArrayList<>(super.validate(bpmnModel));
            for (Process process : bpmnModel.getProcesses()) {
                for (FlowElement element : process.findFlowElementsOfType(ServiceTask.class, true)) {
                    if ("shell".equalsIgnoreCase(((ServiceTask) element).getType())) {
                        ValidationError error = new ValidationError();
                        error.setValidatorSetName(VALIDATOR_SET);
                        error.setKey(PROBLEM);
                        error.setProblem(PROBLEM);
                        error.setDefaultDescription("Shell tasks run commands on the server and are switched off; start the server with "
                                + "modeler.server.allow-shell-tasks=true to allow them");
                        error.setProcessDefinitionId(process.getId());
                        error.setProcessDefinitionName(process.getName());
                        error.setActivityId(element.getId());
                        error.setActivityName(element.getName());
                        error.setXmlLineNumber(element.getXmlRowNumber());
                        error.setXmlColumnNumber(element.getXmlColumnNumber());
                        errors.add(error);
                    }
                }
            }
            return errors;
        }
    }
}
