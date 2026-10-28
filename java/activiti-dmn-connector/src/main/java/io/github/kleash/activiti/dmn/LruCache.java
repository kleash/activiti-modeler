package io.github.kleash.activiti.dmn;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.function.Function;

/**
 * A small thread-safe, size-bounded least-recently-used cache used for parsed DMN documents and deployment lookups.
 * Values are computed outside the cache lock, so a slow computation (compiling a DMN) does not block lookups of other
 * keys, and every key is computed at most once at a time. A computation that fails is not cached.
 *
 * @param <K> key type
 * @param <V> value type
 */
public final class LruCache<K, V> {

    private final Map<K, FutureTask<V>> entries;
    private final int maxEntries;
    private long hits;
    private long misses;

    /**
     * Creates a cache.
     *
     * @param maxEntries the maximum number of entries, at least 1
     */
    public LruCache(int maxEntries) {
        if (maxEntries < 1) {
            throw new IllegalArgumentException("maxEntries must be at least 1");
        }
        this.maxEntries = maxEntries;
        this.entries = new LinkedHashMap<>(16, 0.75f, true) {
            private static final long serialVersionUID = 1L;

            @Override
            protected boolean removeEldestEntry(Map.Entry<K, FutureTask<V>> eldest) {
                return size() > LruCache.this.maxEntries;
            }
        };
    }

    /**
     * Returns the cached value or computes it.
     *
     * @param key    the key
     * @param loader computes the value on a miss
     * @return the value
     * @throws RuntimeException the loader's exception, when it fails (nothing is cached then)
     */
    public V get(K key, Function<K, V> loader) {
        FutureTask<V> task;
        boolean owner = false;
        synchronized (this) {
            task = entries.get(key);
            if (task == null) {
                task = new FutureTask<>(() -> loader.apply(key));
                entries.put(key, task);
                owner = true;
                misses++;
            } else {
                hits++;
            }
        }
        if (owner) {
            task.run();
        }
        try {
            return task.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for the cache to load " + key, e);
        } catch (ExecutionException e) {
            synchronized (this) {
                entries.remove(key, task);
            }
            if (e.getCause() instanceof RuntimeException runtime) {
                throw runtime;
            }
            if (e.getCause() instanceof Error error) {
                throw error;
            }
            throw new IllegalStateException(e.getCause());
        }
    }

    /** @return how many lookups found a value (or a computation in progress) */
    public synchronized long hits() {
        return hits;
    }

    /** @return how many lookups had to compute a value */
    public synchronized long misses() {
        return misses;
    }

    /** @return the number of entries currently held */
    public synchronized int size() {
        return entries.size();
    }

    /** Removes every entry. */
    public synchronized void clear() {
        entries.clear();
    }
}
