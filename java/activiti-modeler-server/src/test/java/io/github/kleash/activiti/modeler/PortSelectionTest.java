package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ServerSocket;

import org.junit.jupiter.api.Test;

import io.github.kleash.activiti.modeler.launch.PortSelection;

class PortSelectionTest {

    @Test
    void theWantedPortIsUsedWhenItIsFree() throws Exception {
        int free;
        try (ServerSocket probe = new ServerSocket(0)) {
            free = probe.getLocalPort();
        }

        assertThat(PortSelection.choose(free)).isEqualTo(free);
    }

    @Test
    void aTakenPortFallsBackToAFreePort() throws Exception {
        try (ServerSocket taken = new ServerSocket(0)) {
            int chosen = PortSelection.choose(taken.getLocalPort());

            assertThat(chosen).isNotEqualTo(taken.getLocalPort());
            assertThat(chosen).isBetween(1024, 65535);
            assertThat(PortSelection.isFree(chosen)).isTrue();
            assertThat(PortSelection.isFree(taken.getLocalPort())).isFalse();
        }
    }

    @Test
    void aPortThatOnlyTheLoopbackAddressHoldsCountsAsTaken() throws Exception {
        try (ServerSocket loopbackOnly = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            assertThat(PortSelection.isFree(loopbackOnly.getLocalPort())).isFalse();
            assertThat(PortSelection.choose(loopbackOnly.getLocalPort())).isNotEqualTo(loopbackOnly.getLocalPort());
        }
    }

    @Test
    void noPreferenceGivesAFreePort() {
        assertThat(PortSelection.choose(0)).isPositive();
    }
}
