package io.github.kleash.activiti.modeler.launch;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.core.env.Environment;

import io.github.kleash.activiti.modeler.ModelerServerProperties;
import io.github.kleash.activiti.modeler.mail.MailServer;

/** Prints where the server is, who may sign in and what is switched on; with {@code --open} (or by default with a display) opens the browser. */
public class ServerBanner implements ApplicationListener<WebServerInitializedEvent> {

    private static final Logger LOG = LoggerFactory.getLogger(ServerBanner.class);

    private final Environment environment;
    private final ModelerServerProperties properties;
    private final org.springframework.beans.factory.ObjectProvider<MailServer> mail;

    public ServerBanner(Environment environment, ModelerServerProperties properties, org.springframework.beans.factory.ObjectProvider<MailServer> mail) {
        this.environment = environment;
        this.properties = properties;
        this.mail = mail;
    }

    /** @return the address a browser on this machine uses ({@code localhost} when the server listens on all addresses) */
    public static String urlOf(Environment environment, int port) {
        String host = environment.getProperty("server.address", "127.0.0.1");
        if (host.isBlank() || host.equals("0.0.0.0") || host.equals("::")) {
            host = "localhost";
        }
        return "http://" + host + ":" + port + "/";
    }

    @Override
    public void onApplicationEvent(WebServerInitializedEvent event) {
        if (!(event.getApplicationContext() instanceof WebServerApplicationContext context) || "management".equals(context.getServerNamespace())) {
            return;
        }
        String url = urlOf(environment, event.getWebServer().getPort());
        String workspace = environment.getProperty("modeler.workspace.dir");
        String logFile = environment.getProperty("logging.file.name");
        String generated = environment.getProperty(ContainerCredentials.GENERATED_PROPERTY);
        MailServer smtp = mail.getIfAvailable();
        StringBuilder text = new StringBuilder("\n");
        text.append("  Activiti modeler server is running at ").append(url).append('\n');
        if (generated != null) {
            text.append("  Sign in as modeler with the password ").append(generated).append(" (generated for this start; set MODELER_PASSWORD to choose your own)\n");
        } else if (properties.getUsers().containsKey("modeler") && "modeler".equals(properties.getUsers().get("modeler").getPassword())) {
            text.append("  Sign in with user modeler, password modeler (demo users: ").append(String.join(", ", properties.getUsers().keySet()))
                    .append("; see docs/user-guide/modeler-server.md)\n");
        } else {
            text.append("  Sign in with HTTP Basic: ").append(String.join(", ", properties.getUsers().keySet())).append('\n');
        }
        text.append("  Workspace: ").append(workspace == null ? "none (start with --workspace=<folder> to open and save project folders)" : workspace).append('\n');
        if (logFile != null) {
            text.append("  Log file: ").append(logFile).append('\n');
        }
        text.append("  Dev endpoints: ").append(environment.getProperty("activiti.rest.dev.enabled", "false")).append(", shell tasks: ")
                .append(properties.isAllowShellTasks() ? "ALLOWED" : "refused").append('\n');
        text.append("  Mail tasks: ").append(smtp == null ? "no embedded SMTP server" : "embedded SMTP server on 127.0.0.1:" + smtp.port()
                + " (messages are listed at " + url + "api/dev/mail)").append('\n');
        LOG.info(text.toString());
        System.out.println(text);
        if (properties.isOpenBrowser()) {
            BrowserOpener.open(url);
        }
    }
}
