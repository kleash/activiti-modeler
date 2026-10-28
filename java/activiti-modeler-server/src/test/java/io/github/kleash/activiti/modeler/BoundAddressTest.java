package io.github.kleash.activiti.modeler;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Collections;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.embedded.tomcat.TomcatWebServer;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;

/** The embedded Tomcat really listens on the loopback address only, not on the machine's other addresses. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BoundAddressTest {

    @LocalServerPort int port;
    @Autowired ServletWebServerApplicationContext context;

    @Test
    void theConnectorIsBoundToTheLoopbackAddress() throws Exception {
        TomcatWebServer tomcat = (TomcatWebServer) context.getWebServer();
        assertThat(String.valueOf(tomcat.getTomcat().getConnector().getProperty("address"))).endsWith("127.0.0.1");
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 2000);
            assertThat(socket.isConnected()).isTrue();
        }
    }

    @Test
    void theServerIsNotReachableOnAnotherAddressOfThisMachine() throws Exception {
        for (var network : Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
            for (InetAddress address : Collections.list(network.getInetAddresses())) {
                if (address.isLoopbackAddress() || address.isLinkLocalAddress() || address instanceof java.net.Inet6Address) {
                    continue;
                }
                try (Socket socket = new Socket()) {
                    org.assertj.core.api.Assertions.assertThatThrownBy(() -> socket.connect(new InetSocketAddress(address, port), 1000))
                            .as("connecting to " + address).isInstanceOf(java.io.IOException.class);
                }
            }
        }
    }
}
