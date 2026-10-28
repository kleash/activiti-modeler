package io.github.kleash.activiti.dmn;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

class LruCacheTest {

    @Test
    void computesOnceAndCountsHitsAndMisses() {
        LruCache<String, String> cache = new LruCache<>(4);
        AtomicInteger loads = new AtomicInteger();

        assertThat(cache.get("a", k -> k + loads.incrementAndGet())).isEqualTo("a1");
        assertThat(cache.get("a", k -> k + loads.incrementAndGet())).isEqualTo("a1");

        assertThat(loads).hasValue(1);
        assertThat(cache.hits()).isEqualTo(1);
        assertThat(cache.misses()).isEqualTo(1);
        assertThat(cache.size()).isEqualTo(1);
    }

    @Test
    void evictsTheLeastRecentlyUsedEntry() {
        LruCache<String, Integer> cache = new LruCache<>(2);
        cache.get("a", k -> 1);
        cache.get("b", k -> 2);
        cache.get("a", k -> 99);
        cache.get("c", k -> 3);

        assertThat(cache.size()).isEqualTo(2);
        assertThat(cache.get("a", k -> 100)).as("a was used recently and survived").isEqualTo(1);
        assertThat(cache.get("b", k -> 200)).as("b was evicted and is loaded again").isEqualTo(200);
    }

    @Test
    void clearEmptiesTheCache() {
        LruCache<String, Integer> cache = new LruCache<>(2);
        cache.get("a", k -> 1);
        cache.clear();

        assertThat(cache.size()).isZero();
    }

    @Test
    void sizeMustBePositive() {
        assertThatThrownBy(() -> new LruCache<String, String>(0)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void failedComputationsAreNotCached() {
        LruCache<String, String> cache = new LruCache<>(2);
        AtomicInteger attempts = new AtomicInteger();

        assertThatThrownBy(() -> cache.get("a", k -> {
            attempts.incrementAndGet();
            throw new DmnModelException("broken");
        })).isInstanceOf(DmnModelException.class).hasMessage("broken");
        assertThat(cache.get("a", k -> "fixed")).isEqualTo("fixed");

        assertThat(attempts).hasValue(1);
    }

    @Test
    void aKeyIsComputedOnceEvenWhenManyThreadsAskAtTheSameTime() throws Exception {
        LruCache<String, Integer> cache = new LruCache<>(4);
        AtomicInteger loads = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Future<Integer>> results = new ArrayList<>();
            for (int i = 0; i < 32; i++) {
                results.add(pool.submit(() -> cache.get("k", k -> {
                    try {
                        Thread.sleep(50);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    return loads.incrementAndGet();
                })));
            }
            for (Future<Integer> result : results) {
                assertThat(result.get(10, TimeUnit.SECONDS)).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(loads).hasValue(1);
    }

    @Test
    void aSlowComputationDoesNotBlockOtherKeys() throws Exception {
        LruCache<String, String> cache = new LruCache<>(4);
        cache.get("fast", k -> "ready");
        CountDownLatch slowStarted = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<String> slow = pool.submit(() -> cache.get("slow", k -> {
                slowStarted.countDown();
                try {
                    release.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return "done";
            }));
            assertThat(slowStarted.await(10, TimeUnit.SECONDS)).isTrue();

            assertThat(cache.get("fast", k -> "reloaded")).as("served while 'slow' is still loading").isEqualTo("ready");
            assertThat(cache.get("other", k -> "new")).isEqualTo("new");

            release.countDown();
            assertThat(slow.get(10, TimeUnit.SECONDS)).isEqualTo("done");
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }
}
