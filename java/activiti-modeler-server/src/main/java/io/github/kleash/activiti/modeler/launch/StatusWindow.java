package io.github.kleash.activiti.modeler.launch;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.util.function.Consumer;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;

/**
 * The small window of a double-clicked app (ADR 0008): it says the server is starting or running, shows the address and the sign-in,
 * and has the two buttons a person needs, <b>Open in browser</b> and <b>Quit</b>. Closing the window quits, so there is always a visible
 * way to stop the server. Only created when a display exists ({@code !GraphicsEnvironment.isHeadless()}); its content is built without
 * the frame, so the buttons can be tested without a display.
 */
public final class StatusWindow {

    private final Runnable onQuit;
    private final Consumer<String> browser;
    private JFrame frame;
    private JLabel headline;
    private JLabel detail;
    private JTextField address;
    private JLabel signIn;
    private JTextField workspaceField;
    private JTextField logField;
    private JPanel workspaceRow;
    private JPanel logRow;
    private JButton open;
    private volatile String url;

    /** @param browser opens an address (the real one is {@link BrowserOpener#open}) */
    StatusWindow(Runnable onQuit, Consumer<String> browser) {
        this.onQuit = onQuit;
        this.browser = browser;
    }

    /** Shows the window in the "starting" state. Must be called with a display. */
    public static StatusWindow show(Runnable onQuit) {
        StatusWindow window = new StatusWindow(onQuit, BrowserOpener::open);
        try {
            SwingUtilities.invokeAndWait(window::build);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot show the status window: " + e.getMessage(), e);
        }
        return window;
    }

    private void build() {
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        } catch (Exception ignored) {
            // the default look is fine
        }
        frame = new JFrame("Activiti Modeler");
        frame.setDefaultCloseOperation(JFrame.DO_NOTHING_ON_CLOSE);
        frame.addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent event) {
                onQuit.run();
            }
        });
        frame.setContentPane(content());
        frame.pack();
        frame.setSize(Math.max(frame.getWidth(), 440), frame.getHeight());
        frame.setMinimumSize(new Dimension(frame.getWidth(), frame.getHeight()));
        frame.setLocationRelativeTo(null);
        frame.setVisible(true);
    }

    /** The text and the two buttons, in the "starting" state. Needs no display (no window is created); call it on the event thread. */
    JPanel content() {
        headline = new JLabel("Activiti Modeler is starting...");
        headline.setFont(headline.getFont().deriveFont(Font.BOLD, headline.getFont().getSize2D() + 4f));
        detail = new JLabel("The engine takes a few seconds to start.");
        address = new JTextField(" ");
        address.setEditable(false);
        address.setColumns(28);
        signIn = new JLabel(" ");
        workspaceField = readOnlyField();
        logField = readOnlyField();
        workspaceRow = labelled("Projects", workspaceField);
        logRow = labelled("Log", logField);
        // nothing to show about these until the server is up
        address.setVisible(false);
        signIn.setVisible(false);
        workspaceRow.setVisible(false);
        logRow.setVisible(false);

        JPanel text = new JPanel(new GridBagLayout());
        GridBagConstraints row = new GridBagConstraints();
        row.gridx = 0;
        row.anchor = GridBagConstraints.WEST;
        row.fill = GridBagConstraints.HORIZONTAL;
        row.weightx = 1;
        row.insets = new Insets(2, 0, 2, 0);
        for (java.awt.Component component : new java.awt.Component[] {headline, detail, address, signIn, workspaceRow, logRow}) {
            text.add(component, row);
        }

        open = new JButton("Open in browser");
        open.setEnabled(false);
        open.addActionListener(event -> {
            String target = url;
            if (target != null) {
                browser.accept(target);
            }
        });
        JButton quit = new JButton("Quit");
        quit.addActionListener(event -> onQuit.run());
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 8, 0));
        buttons.add(open);
        buttons.add(quit);

        JPanel content = new JPanel(new BorderLayout(0, 14));
        content.setBorder(BorderFactory.createEmptyBorder(16, 18, 14, 18));
        content.add(text, BorderLayout.CENTER);
        content.add(buttons, BorderLayout.SOUTH);
        return content;
    }

    /**
     * The server is up.
     *
     * @param serverUrl the address of the modeler
     * @param user      the user to sign in as, or {@code null}
     * @param password  its password, or {@code null}
     * @param workspace the project folder, or {@code null}
     * @param logs      the log file, or {@code null}
     */
    public void running(String serverUrl, String user, String password, String workspace, String logs) {
        this.url = serverUrl;
        SwingUtilities.invokeLater(() -> {
            headline.setText("Activiti Modeler is running");
            detail.setText("Open it in your browser:");
            address.setText(serverUrl);
            address.setVisible(true);
            signIn.setVisible(user != null);
            workspaceRow.setVisible(workspace != null);
            logRow.setVisible(logs != null);
            workspaceField.setText(workspace == null ? "" : workspace);
            workspaceField.setCaretPosition(0);
            logField.setText(logs == null ? "" : logs);
            logField.setCaretPosition(0);
            signIn.setText(user == null ? " " : "Sign in with user \"" + user + "\" and password \"" + password + "\"");
            open.setEnabled(true);
            pack();
        });
    }

    /** The server did not start. */
    public void failed(String message, String logs) {
        SwingUtilities.invokeLater(() -> {
            headline.setText("Activiti Modeler could not start");
            headline.setForeground(new Color(0xB00020));
            detail.setText("<html>" + escape(message) + "</html>");
            logRow.setVisible(logs != null);
            logField.setText(logs == null ? "" : logs);
            logField.setCaretPosition(0);
            open.setEnabled(false);
            pack();
        });
    }

    private void pack() {
        if (frame != null) {
            frame.pack();
        }
    }

    /** A selectable, copyable line: a long path must not widen the window. */
    private static JTextField readOnlyField() {
        JTextField field = new JTextField();
        field.setEditable(false);
        field.setColumns(28);
        return field;
    }

    private static JPanel labelled(String label, JTextField field) {
        JPanel row = new JPanel(new BorderLayout(8, 0));
        JLabel name = new JLabel(label);
        name.setForeground(Color.GRAY);
        name.setPreferredSize(new Dimension(60, name.getPreferredSize().height));
        row.add(name, BorderLayout.WEST);
        row.add(field, BorderLayout.CENTER);
        return row;
    }

    private static String escape(String text) {
        return text == null ? "-" : text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
