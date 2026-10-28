package io.github.kleash.activiti.dmn.e2e;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.activiti.engine.delegate.event.ActivitiEvent;
import org.activiti.engine.delegate.event.ActivitiEventListener;
import org.activiti.engine.delegate.event.ActivitiEventType;
import org.activiti.engine.delegate.event.ActivitiSequenceFlowTakenEvent;

/** Engine event listener that records the sequence flows taken, in order (the path of a process instance). */
public class SequenceFlowRecorder implements ActivitiEventListener {

    /**
     * One sequence flow taken.
     *
     * @param processInstanceId the instance
     * @param flowId            the sequence flow id
     * @param sourceActivityId  the activity the token left
     * @param targetActivityId  the activity the token entered
     */
    public record Flow(String processInstanceId, String flowId, String sourceActivityId, String targetActivityId) {
    }

    private final List<Flow> flows = Collections.synchronizedList(new ArrayList<>());

    @Override
    public void onEvent(ActivitiEvent event) {
        if (event.getType() == ActivitiEventType.SEQUENCEFLOW_TAKEN && event instanceof ActivitiSequenceFlowTakenEvent taken) {
            flows.add(new Flow(event.getProcessInstanceId(), taken.getId(), taken.getSourceActivityId(), taken.getTargetActivityId()));
        }
    }

    @Override
    public boolean isFailOnException() {
        return true;
    }

    /**
     * @param processInstanceId an instance id
     * @return the flows taken by that instance, in the order they were taken
     */
    public List<Flow> flowsOf(String processInstanceId) {
        synchronized (flows) {
            return flows.stream().filter(f -> processInstanceId.equals(f.processInstanceId())).toList();
        }
    }
}
