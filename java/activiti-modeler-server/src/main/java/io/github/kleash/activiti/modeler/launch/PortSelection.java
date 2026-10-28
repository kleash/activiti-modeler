package io.github.kleash.activiti.modeler.launch;

import java.io.IOException;
import java.net.ServerSocket;

/** Picks the port the server listens on when the person gave none: the preferred one, or a free one when it is taken. */
public final class PortSelection {

    private PortSelection() {
    }

    /**
     * @param preferred the port to use if it is free
     * @return {@code preferred} when nothing listens there, otherwise a port the operating system reports as free
     */
    public static int choose(int preferred) {
        if (preferred > 0 && isFree(preferred)) {
            return preferred;
        }
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException("No free port on this machine: " + e.getMessage(), e);
        }
    }

    /** @return whether a server socket can listen on the port (on all addresses, which also fails when only the loopback address is taken) */
    public static boolean isFree(int port) {
        try (ServerSocket socket = new ServerSocket(port)) {
            return socket.getLocalPort() == port;
        } catch (IOException e) {
            return false;
        }
    }
}
