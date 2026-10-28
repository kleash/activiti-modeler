import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;

/**
 * The Docker HEALTHCHECK of the image. The runtime image has no shell and no curl, so the check is this one class, run by the image's own
 * Java: GET /api/health on the loopback address, exit 0 when the answer is 200 and says UP, 1 otherwise. Compiled by the Dockerfile, not part
 * of the server jar.
 */
public final class Healthcheck {

    private Healthcheck() {
    }

    public static void main(String[] args) {
        String port = System.getenv().getOrDefault("SERVER_PORT", "8080");
        int status = 1;
        try {
            HttpURLConnection connection = (HttpURLConnection) URI.create("http://127.0.0.1:" + port + "/api/health").toURL().openConnection();
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(5000);
            if (connection.getResponseCode() == 200) {
                String body = new String(connection.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                status = body.contains("UP") ? 0 : 1;
            }
        } catch (Exception e) {
            System.err.println("health check failed: " + e);
        }
        System.exit(status);
    }
}
