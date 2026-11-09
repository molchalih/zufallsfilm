import type { Metrics } from "./metrics";
import type { Store } from "./store";

type Counts = Pick<Store, "countFilms" | "countUsers">;

/**
 * The fetch handler for the internal metrics listener.
 *
 * `items_cached` and `users` are read straight from the store on every scrape,
 * so the gauges are the live table counts at the moment Prometheus asks rather
 * than a value some writer remembered to update. Only `GET /metrics` answers;
 * everything else is a flat 404, since nothing but the sidecar's scrape should
 * ever reach this listener.
 */
export function createMetricsFetch(deps: { metrics: Metrics; store: Counts }) {
  const { metrics, store } = deps;
  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (req.method !== "GET" || pathname !== "/metrics") {
      return new Response("not found\n", { status: 404 });
    }
    metrics.setItemsCached(store.countFilms());
    metrics.setUsers(store.countUsers());
    return new Response(await metrics.expose(), {
      status: 200,
      headers: { "Content-Type": metrics.registry.contentType },
    });
  };
}

/**
 * Starts the internal metrics listener.
 *
 * Bound to 0.0.0.0, deliberately, NOT loopback: the mTLS metrics hop is a
 * separate container on the private per-uid podman network and reaches this
 * listener over that network, so a loopback bind would be unreachable from it.
 * The port is never published to the host or the VLAN — only the sidecar's
 * mTLS port is — so inside the container 0.0.0.0 means reachable only by the
 * sidecar. Exposure is the deployment's job, not this process's. See
 * docs/decisions/DR-005-internal-metrics-endpoint.md.
 */
export function startMetricsServer(deps: { metrics: Metrics; store: Counts; port: number }) {
  return Bun.serve({
    hostname: "0.0.0.0",
    port: deps.port,
    fetch: createMetricsFetch(deps),
  });
}
