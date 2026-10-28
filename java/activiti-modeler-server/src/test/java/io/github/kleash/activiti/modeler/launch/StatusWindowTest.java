package io.github.kleash.activiti.modeler.launch;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.Component;
import java.awt.Container;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.FutureTask;
import java.util.concurrent.atomic.AtomicInteger;

import javax.swing.AbstractButton;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;
import javax.swing.text.JTextComponent;

import org.junit.jupiter.api.Test;

/**
 * The status window of a start without arguments (K3, ADR 0008): its buttons <b>Open in browser</b> and <b>Quit</b>. The tests run
 * headless (surefire sets {@code java.awt.headless}): they press the buttons of the window's content, which needs no display, and
 * record what the browser would have been asked to open instead of starting one.
 */
class StatusWindowTest {

    private final List<String> opened = new CopyOnWriteArrayList<>();
    private final AtomicInteger quits = new AtomicInteger();
    private final StatusWindow window = new StatusWindow(quits::incrementAndGet, opened::add);

    @Test
    void openInBrowserOpensTheAddressOnceTheServerRunsAndQuitStopsTheServer() throws Exception {
        JPanel content = onEventThread(window::content);
        JButton open = button(content, "Open in browser");
        JButton quit = button(content, "Quit");

        // while the server starts there is nothing to open
        assertThat(texts(content)).contains("Activiti Modeler is starting...");
        assertThat(open.isEnabled()).isFalse();
        onEventThread(() -> click(open));
        assertThat(opened).isEmpty();

        window.running("http://127.0.0.1:8080/", "modeler", "secret", "/home/ann/ActivitiModeler/workspace", "/home/ann/ActivitiModeler/logs/activiti-modeler.log");
        // running() updates the window on the event thread: wait for it
        onEventThread(() -> null);
        assertThat(texts(content)).contains("Activiti Modeler is running", "http://127.0.0.1:8080/",
                "Sign in with user \"modeler\" and password \"secret\"", "/home/ann/ActivitiModeler/workspace");
        assertThat(open.isEnabled()).isTrue();

        onEventThread(() -> click(open));
        assertThat(opened).containsExactly("http://127.0.0.1:8080/");
        assertThat(quits).hasValue(0);

        onEventThread(() -> click(quit));
        assertThat(quits).hasValue(1);
        assertThat(opened).containsExactly("http://127.0.0.1:8080/");
    }

    @Test
    void aStartThatFailedOffersNothingToOpenAndQuitStillStopsTheProcess() throws Exception {
        JPanel content = onEventThread(window::content);
        JButton open = button(content, "Open in browser");
        JButton quit = button(content, "Quit");

        window.failed("Port 8080 is <in use>", "/home/ann/ActivitiModeler/logs");
        onEventThread(() -> null);
        assertThat(texts(content)).contains("Activiti Modeler could not start", "<html>Port 8080 is &lt;in use&gt;</html>", "/home/ann/ActivitiModeler/logs");
        assertThat(open.isEnabled()).isFalse();
        onEventThread(() -> click(open));
        assertThat(opened).isEmpty();

        onEventThread(() -> click(quit));
        assertThat(quits).hasValue(1);
    }

    /** A click as the person makes it: nothing happens on a disabled button. */
    private static Void click(AbstractButton button) {
        button.doClick(0);
        return null;
    }

    private static <T> T onEventThread(Callable<T> work) throws Exception {
        FutureTask<T> task = new FutureTask<>(work);
        SwingUtilities.invokeAndWait(task);
        return task.get();
    }

    private static JButton button(Container root, String text) {
        return components(root).stream().filter(c -> c instanceof JButton b && text.equals(b.getText())).map(JButton.class::cast)
                .findFirst().orElseThrow(() -> new AssertionError("no button \"" + text + "\" in the status window"));
    }

    /** The texts of the labels and text fields that are shown. */
    private static List<String> texts(Container root) {
        List<String> texts = new ArrayList<>();
        for (Component c : components(root)) {
            if (!c.isVisible() || !c.getParent().isVisible()) {
                continue;
            }
            if (c instanceof JLabel label) {
                texts.add(label.getText());
            } else if (c instanceof JTextComponent field) {
                texts.add(field.getText());
            }
        }
        return texts;
    }

    private static List<Component> components(Container root) {
        List<Component> all = new ArrayList<>();
        for (Component c : root.getComponents()) {
            all.add(c);
            if (c instanceof Container inner) {
                all.addAll(components(inner));
            }
        }
        return all;
    }
}
