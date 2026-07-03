import { type FieldSparkline } from '@grafana/data';

import { readScalar, readSeries, runInstantQueries, runRangeQuery } from './promQuery';

export const KUBERNETES_APP_ID = 'grafana-k8s-app';

export interface KubernetesOverview {
  clusters: number;
  pods: number;
  alertsFiring: number | null; // null = no firing alerts or Prometheus evaluates no rules (hide the count)
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
  // Prometheus exports its own firing alert instances as the built-in ALERTS metric. Watchdog and
  // InfoInhibitor are kube-prometheus-stack's always-firing heartbeats, not problems — exclude them
  // or every stack reports a permanent "1 alert firing". count() over no matches is empty → null.
  alertsFiring: 'count(ALERTS{alertstate="firing", alertname!~"Watchdog|InfoInhibitor"})',
};

type KubernetesHealthSeverity = 'healthy' | 'warning' | 'critical';

export interface KubernetesHealth {
  // Single verdict collapsed from the available health signals.
  severity: KubernetesHealthSeverity;
}

// Collapse the health signals into one verdict. Returns null when NONE are available
// (e.g. Prometheus scrapes only inventory metrics) — absence of data is not health.
export function computeHealth(o: KubernetesOverview): KubernetesHealth | null {
  if (o.alertsFiring === null && o.unhealthyPods === null && o.notReadyNodes === null && o.restarts1h === null) {
    return null;
  }
  // Pods pending/failed and not-ready nodes are resources in a bad state (critical); restarts and
  // firing alerts are softer signals (warning). null counts as 0 so a partial metric set still verdicts.
  const badResources = (o.unhealthyPods ?? 0) + (o.notReadyNodes ?? 0);
  const total = badResources + (o.restarts1h ?? 0) + (o.alertsFiring ?? 0);
  const severity: KubernetesHealthSeverity = total === 0 ? 'healthy' : badResources > 0 ? 'critical' : 'warning';
  return { severity };
}

/**
 * Resolve overview counts from Prometheus rather than a plugin REST endpoint: the k8s app has no
 * "summary" API, so we run portable kube-state-metrics instant queries directly. Picks the default
 * Prometheus datasource, else the first — throwing when none (the caller then omits the entry).
 */
export async function fetchKubernetesOverview(): Promise<KubernetesOverview> {
  const frames = await runInstantQueries(OVERVIEW_QUERIES);
  return {
    clusters: readScalar(frames, 'clusters') ?? 0,
    pods: readScalar(frames, 'pods') ?? 0,
    alertsFiring: readScalar(frames, 'alertsFiring'),
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
  const frames = await runRangeQuery('cpu', 'sum(rate(container_cpu_usage_seconds_total{container!=""}[5m]))', 24);
  return readSeries(frames, 'cpu');
}
