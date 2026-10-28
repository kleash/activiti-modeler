package io.github.kleash.activiti.modeler.launch;

import java.awt.Desktop;
import java.io.IOException;
import java.net.URI;
import java.util.Locale;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Opens a page in the default browser. */
public final class BrowserOpener {

    private static final Logger LOG = LoggerFactory.getLogger(BrowserOpener.class);

    private BrowserOpener() {
    }

    /** Opens the URL; tells the person to do it themselves when no browser can be started. */
    public static void open(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(url));
                return;
            }
        } catch (IOException | RuntimeException e) {
            LOG.debug("java.awt.Desktop cannot open the browser", e);
        }
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        String[] command = os.contains("mac") ? new String[] {"open", url}
                : os.contains("win") ? new String[] {"cmd", "/c", "start", url} : new String[] {"xdg-open", url};
        try {
            new ProcessBuilder(command).inheritIO().start();
        } catch (IOException e) {
            LOG.warn("Could not open the browser ({}); open {} yourself", e.getMessage(), url);
        }
    }
}
