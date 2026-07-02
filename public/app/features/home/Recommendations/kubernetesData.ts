import { type FieldSparkline } from '@grafana/data';

import { readScalar, readSeries, runInstantQueries, runRangeQuery } from './promQuery';

export const KUBERNETES_APP_ID = 'grafana-k8s-app';

export interface KubernetesOverview {
  clusters: number;
  pods: number;
  unhealthyPods: number | null; // null = metric absent (hide the row); 0 = all healthy
  restarts1h: number | null; // null = metric absent (hide the row)
  notReadyNodes: number | null; // null = metric absent (hide the row); 0 = all Ready
}

const KUBE_STATE_LOOKBACK = '24h';

// refId -> portable kube-state-metrics PromQL. No recording rules: works on any Prometheus scraping
// kube-state-metrics. Use a lookback for gauge-style kube-state metrics so seeded/demo samples that
// are not continuously scraped still render after Prometheus's instant-query lookback expires.
// `group by (...)` dedupes series across replicas before count().
const OVERVIEW_QUERIES: Record<string, string> = {
  clusters: `count(group by (cluster) (last_over_time(kube_node_info[${KUBE_STATE_LOOKBACK}])))`,
  pods: `count(group by (cluster, namespace, pod) (last_over_time(kube_pod_info[${KUBE_STATE_LOOKBACK}])))`,
  unhealthyPods: `sum(last_over_time(kube_pod_status_phase{phase=~"Pending|Failed|Unknown"}[${KUBE_STATE_LOOKBACK}]))`,
  restarts1h: 'sum(increase(kube_pod_container_status_restarts_total[1h]))',
  notReadyNodes: `sum(last_over_time(kube_node_status_condition{condition="Ready",status="false"}[${KUBE_STATE_LOOKBACK}]))`,
};

type KubernetesHealthSeverity = 'healthy' | 'warning' | 'critical';

export interface KubernetesHealth {
  // Total problems = unhealthy pods + not-ready nodes + recent container restarts, over the available signals.
  issues: number;
  severity: KubernetesHealthSeverity;
}

// Collapse the three health signals into one header verdict. Returns null when NONE are available
// (e.g. Prometheus scrapes only inventory metrics) — the pill is then hidden, since absence is not health.
export function computeHealth(o: KubernetesOverview): KubernetesHealth | null {
  if (o.unhealthyPods === null && o.notReadyNodes === null && o.restarts1h === null) {
    return null;
  }
  // Pods pending/failed and not-ready nodes are resources in a bad state (critical); restarts alone are a
  // softer signal (warning). null signals count as 0 so a partial metric set still yields a verdict.
  const badResources = (o.unhealthyPods ?? 0) + (o.notReadyNodes ?? 0);
  const issues = badResources + (o.restarts1h ?? 0);
  const severity: KubernetesHealthSeverity = issues === 0 ? 'healthy' : badResources > 0 ? 'critical' : 'warning';
  return { issues, severity };
}

/**
 * Resolve overview counts from Prometheus rather than a plugin REST endpoint: the k8s app has no
 * "summary" API, so we run portable kube-state-metrics instant queries directly. Picks the default
 * Prometheus datasource, else the first — throwing (handled as a retryable error) when none.
 */
export async function fetchKubernetesOverview(): Promise<KubernetesOverview> {
  const frames = await runInstantQueries('prometheus', OVERVIEW_QUERIES);
  return {
    clusters: readScalar(frames, 'clusters') ?? 0,
    pods: readScalar(frames, 'pods') ?? 0,
    unhealthyPods: readScalar(frames, 'unhealthyPods'),
    restarts1h: readScalar(frames, 'restarts1h'),
    notReadyNodes: readScalar(frames, 'notReadyNodes'),
  };
}

/**
 * Aggregate cluster CPU usage over the last 24h as a sparkline series. Portable cAdvisor PromQL (no
 * recording rules); returns null when the target Prometheus lacks the metric so the caller can omit
 * the sparkline without surfacing an error.
 */
export async function fetchClusterCpuSeries(): Promise<FieldSparkline | null> {
  const frames = await runRangeQuery(
    'prometheus',
    'cpu',
    'sum(rate(container_cpu_usage_seconds_total{container!=""}[5m]))',
    24
  );
  return readSeries(frames, 'cpu');
}
