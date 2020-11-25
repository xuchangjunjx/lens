import { LensApiRequest } from "../router";
import { LensApi } from "../lens-api";
import { Cluster } from "../cluster";
import _ from "lodash";

export type IMetricsQuery = string | string[] | {
  [metricName: string]: string;
};

// This is used for backoff retry tracking.
const MAX_ATTEMPTS = 5;
const ATTEMPTS = [...(_.fill(Array(MAX_ATTEMPTS - 1), false)), true];

// prometheus metrics loader
async function loadMetrics(promQueries: string[], cluster: Cluster, prometheusPath: string, queryParams: Record<string, string>): Promise<any[]> {
  const queries = promQueries.map(p => p.trim());
  const loaders = new Map<string, Promise<any>>();

  async function loadMetric(query: string): Promise<any> {
    async function loadMetricHelper(): Promise<any> {
      for (const [attempt, lastAttempt] of ATTEMPTS.entries()) { // retry
        try {
          return await cluster.getMetrics(prometheusPath, { query, ...queryParams });
        } catch (error) {
          if (lastAttempt || error?.statusCode === 404) {
            return {
              status: error.toString(),
              data: { result: [] },
            };
          }

          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000)); // add delay before repeating request
        }
      }
    }

    return loaders.get(query) ?? loaders.set(query, loadMetricHelper()).get(query);
  }

  return Promise.all(queries.map(loadMetric));
}

class MetricsRoute extends LensApi {
  async routeMetrics({ response, cluster, payload, query }: LensApiRequest) {
    const queryParams: IMetricsQuery = Object.fromEntries(query.entries());

    try {
      const [prometheusPath, prometheusProvider] = await Promise.all([
        cluster.contextHandler.getPrometheusPath(),
        cluster.contextHandler.getPrometheusProvider()
      ]);

      // return data in same structure as query
      if (typeof payload === "string") {
        const [data] = await loadMetrics([payload], cluster, prometheusPath, queryParams);
        this.respondJson(response, data);
      } else if (Array.isArray(payload)) {
        const data = await loadMetrics(payload, cluster, prometheusPath, queryParams);
        this.respondJson(response, data);
      } else {
        const queries = Object.entries(payload).map(([queryName, queryOpts]) => (
          (prometheusProvider.getQueries(queryOpts) as Record<string, string>)[queryName]
        ));
        const result = await loadMetrics(queries, cluster, prometheusPath, queryParams);
        const data = Object.fromEntries(Object.keys(payload).map((metricName, i) => [metricName, result[i]]));
        this.respondJson(response, data);
      }
    } catch {
      this.respondJson(response, {});
    }
  }
}

export const metricsRoute = new MetricsRoute();
