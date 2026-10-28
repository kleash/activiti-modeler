package io.github.kleash.activiti.modeler;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** {@code modeler.server.*}: settings of the modeler server (the workspace folder is {@code modeler.workspace.*}). */
@ConfigurationProperties(prefix = "modeler.server")
public class ModelerServerProperties {

    /**
     * Allow service tasks of type {@code shell} (they run commands on this machine). Off by default: a model with a shell task is
     * refused at deployment, by validate, deploy and scenario run alike.
     */
    private boolean allowShellTasks = false;

    /** Open the modeler in the default browser once the server is up ({@code --open}; {@code main} turns it on when a display exists). */
    private boolean openBrowser = false;

    /**
     * Show the small status window (address, sign-in, Open in browser and Quit). Set by {@code main} from the display: on when one
     * exists, off headless and in the container. {@code --no-window} switches it off.
     */
    private boolean statusWindow = false;

    /**
     * Demo users for HTTP Basic, by user name. The authorities are Spring Security authorities: {@code ROLE_ACTIVITI_USER} may use
     * the API and work on tasks, {@code ROLE_ACTIVITI_ADMIN} may also use the dev endpoints, and {@code GROUP_<name>} makes the
     * user a member of the candidate group {@code <name>}.
     */
    private Map<String, User> users = new LinkedHashMap<>();

    private final Cors cors = new Cors();
    private final Mail mail = new Mail();

    public boolean isAllowShellTasks() {
        return allowShellTasks;
    }

    public void setAllowShellTasks(boolean allowShellTasks) {
        this.allowShellTasks = allowShellTasks;
    }

    public boolean isOpenBrowser() {
        return openBrowser;
    }

    public void setOpenBrowser(boolean openBrowser) {
        this.openBrowser = openBrowser;
    }

    public boolean isStatusWindow() {
        return statusWindow;
    }

    public void setStatusWindow(boolean statusWindow) {
        this.statusWindow = statusWindow;
    }

    public Map<String, User> getUsers() {
        return users;
    }

    public void setUsers(Map<String, User> users) {
        this.users = users;
    }

    public Cors getCors() {
        return cors;
    }

    public Mail getMail() {
        return mail;
    }

    /** One demo user. */
    public static class User {

        /** The password; without a prefix it is used as is ({@code {noop}}), a prefix such as {@code {bcrypt}} selects the encoder. */
        private String password;

        /** Spring Security authorities. */
        private List<String> authorities = new ArrayList<>();

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }

        public List<String> getAuthorities() {
            return authorities;
        }

        public void setAuthorities(List<String> authorities) {
            this.authorities = authorities;
        }
    }

    /** CORS, for the app served by {@code vite dev} (another origin than the server). The bundled app is same-origin and needs none. */
    public static class Cors {

        /** Origins that may call the API from a browser. Empty switches CORS off. */
        private List<String> allowedOrigins = new ArrayList<>(List.of("http://localhost:5173", "http://localhost:4173"));

        /** Whether the browser may send credentials (cookies); the API uses an Authorization header and needs no credentials mode. */
        private boolean allowCredentials = false;

        /** How long a browser may cache a preflight answer. */
        private long maxAgeSeconds = 3600;

        public List<String> getAllowedOrigins() {
            return allowedOrigins;
        }

        public void setAllowedOrigins(List<String> allowedOrigins) {
            this.allowedOrigins = allowedOrigins;
        }

        public boolean isAllowCredentials() {
            return allowCredentials;
        }

        public void setAllowCredentials(boolean allowCredentials) {
            this.allowCredentials = allowCredentials;
        }

        public long getMaxAgeSeconds() {
            return maxAgeSeconds;
        }

        public void setMaxAgeSeconds(long maxAgeSeconds) {
            this.maxAgeSeconds = maxAgeSeconds;
        }
    }

    /** The embedded SMTP server (GreenMail) that mail tasks send to. */
    public static class Mail {

        /** Start the SMTP server and point the engine's mail settings at it. Off: mail tasks use {@code spring.activiti.mail-server-*}. */
        private boolean enabled = true;

        /** SMTP port; 0 picks a free port (shown at startup and by {@code GET /api/dev/mail}). */
        private int port = 0;

        /** The {@code From} address of mail tasks that name none. */
        private String defaultFrom = "modeler@localhost";

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public int getPort() {
            return port;
        }

        public void setPort(int port) {
            this.port = port;
        }

        public String getDefaultFrom() {
            return defaultFrom;
        }

        public void setDefaultFrom(String defaultFrom) {
            this.defaultFrom = defaultFrom;
        }
    }
}
