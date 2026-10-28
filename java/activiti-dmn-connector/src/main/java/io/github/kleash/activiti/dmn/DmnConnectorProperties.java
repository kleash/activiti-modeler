package io.github.kleash.activiti.dmn;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configuration of the DMN connector, prefix {@code activiti.dmn}. */
@ConfigurationProperties(prefix = "activiti.dmn")
public class DmnConnectorProperties {

    /** Engine used to evaluate decisions: {@code operaton} (default) or {@code kie} (needs activiti-dmn-connector-kie). */
    private String engine = OperatonDmnEvaluator.NAME;

    /** Set to {@code false} to switch the connector off (the bean {@code dmn-connector.EXECUTE_TABLE} is not registered). */
    private boolean enabled = true;

    /** How many parsed DMN documents, resolved deployments and process definitions each cache keeps. */
    private int cacheSize = 256;

    /** @return the engine name */
    public String getEngine() {
        return engine;
    }

    /** @param engine {@code operaton} or {@code kie} */
    public void setEngine(String engine) {
        this.engine = engine;
    }

    /** @return whether the connector is registered */
    public boolean isEnabled() {
        return enabled;
    }

    /** @param enabled whether to register the connector */
    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    /** @return the cache size */
    public int getCacheSize() {
        return cacheSize;
    }

    /** @param cacheSize the cache size, at least 1 */
    public void setCacheSize(int cacheSize) {
        this.cacheSize = cacheSize;
    }
}
