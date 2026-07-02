import { css } from '@emotion/css';
import { useMemo, useState } from 'react';
import { useAsyncRetry, useMeasure } from 'react-use';

import {
  type FieldConfig,
  type FieldSparkline,
  type IconName,
  type GrafanaTheme2,
  type PluginMeta,
  locationUtil,
} from '@grafana/data';
import { t, Trans } from '@grafana/i18n';
import { type GraphFieldConfig, GraphGradientMode, LineInterpolation } from '@grafana/schema';
import { Button, Dropdown, Icon, LinkButton, Menu, Sparkline, Stack, Text, useStyles2, useTheme2 } from '@grafana/ui';
import { createBridgeURL } from 'app/features/alerting/unified/components/PluginBridge';
import { canAccessPluginPage, usePluginBridge } from 'app/features/alerting/unified/hooks/usePluginBridge';

import {
  computeHealth,
  fetchClusterCpuSeries,
  fetchKubernetesOverview,
  KUBERNETES_APP_ID,
  type KubernetesOverview,
} from './kubernetesData';

const SPARKLINE_HEIGHT = 56;

interface ExistingItem {
  title: string;
  icon: IconName;
  stats: {
    primary: string;
    secondary: string;
  };
  // Absent when the solution has no time series to show (e.g. the stubs, or the metric is missing).
  sparkline?: {
    series: FieldSparkline;
    caption: string;
  };
  // Absent when the solution is healthy — real data only alerts when something is wrong.
  alert?: {
    primary: string;
    secondary?: string;
    action: string;
    href: string;
  };
  action: string;
  href: string;
}

// Stubbed data for initial development — placeholders until these solutions get a real data layer
// like the Kubernetes item built in buildKubernetesItem below.
const stubbedExisting: ExistingItem[] = [
  {
    title: 'Hosted Metrics',
    icon: 'chart-line',
    stats: {
      primary: '4.2M series',
      secondary: '12 hosts',
    },
    alert: {
      primary: '3 hosts above 90% disk',
      secondary: 'web-03 critical at 96% — ~6 h to full',
      action: 'View',
      href: '#',
    },
    action: 'Open infrastructure',
    href: '#',
  },
  {
    title: 'Hosted Logs',
    icon: 'file-alt',
    stats: {
      primary: '47 GB ingested',
      secondary: '8 sources',
    },
    alert: {
      primary: 'Ingest spike detected',
      secondary: 'checkout-service logs up 3x in the last hour',
      action: 'View',
      href: '#',
    },
    action: 'Open Explore (Logs)',
    href: '#',
  },
];

/**
 * Build the Kubernetes Monitoring entry from live Prometheus data. Returns null when the user
 * cannot access the app's home page — an entry whose every action dead-ends is worse than none.
 */
function buildKubernetesItem(
  overview: KubernetesOverview,
  cpuSeries: FieldSparkline | null,
  settings?: PluginMeta<{}>
): ExistingItem | null {
  const bridgePath = createBridgeURL(KUBERNETES_APP_ID, '/home');
  if (!settings || !canAccessPluginPage(settings, bridgePath)) {
    return null;
  }
  // Wrap the raw /a/... bridge paths so copy-link / open-in-new-tab is correct under config.appSubUrl.
  const href = locationUtil.assureBaseUrl(bridgePath);
  // The alert strip's View drills into the app's alerts page; fall back to the app home if the
  // include role/action semantics deny that specific page.
  const alertsBridgePath = createBridgeURL(KUBERNETES_APP_ID, '/alerts');
  const alertsHref = canAccessPluginPage(settings, alertsBridgePath)
    ? locationUtil.assureBaseUrl(alertsBridgePath)
    : href;

  // Filter on the RAW signal (>0), display with Math.ceil: a 0.4 restart signal keeps computeHealth at
  // 'warning' but must not round to "0 restarts", and increase() yields fractions we never want to show.
  const healthRows: string[] = [];
  if (overview.unhealthyPods !== null && overview.unhealthyPods > 0) {
    healthRows.push(
      t('home.recommendations.health.pods', '{{value}} pods pending or failed', {
        value: Math.ceil(overview.unhealthyPods),
      })
    );
  }
  if (overview.restarts1h !== null && overview.restarts1h > 0) {
    healthRows.push(
      t('home.recommendations.health.restarts', '{{value}} restarts in the last hour', {
        value: Math.ceil(overview.restarts1h),
      })
    );
  }
  if (overview.notReadyNodes !== null && overview.notReadyNodes > 0) {
    healthRows.push(
      t('home.recommendations.health.nodes', '{{value}} nodes not ready', {
        value: Math.ceil(overview.notReadyNodes),
      })
    );
  }

  const alertsFiring = overview.alertsFiring ?? 0;
  const health = computeHealth(overview);
  // Every positive signal contributes either the firing count or a health row, so a non-healthy
  // verdict always has content to show.
  const showAlert = health !== null && health.severity !== 'healthy';

  return {
    title: t('home.recommendations.kubernetes.title', 'Kubernetes Monitoring'),
    icon: 'kubernetes',
    stats: {
      primary: t('home.recommendations.kubernetes.clusters', '{{value}} clusters', {
        value: overview.clusters.toLocaleString(),
      }),
      secondary: t('home.recommendations.kubernetes.pods', '{{value}} pods', {
        value: overview.pods.toLocaleString(),
      }),
    },
    sparkline: cpuSeries
      ? {
          series: cpuSeries,
          caption: t('home.recommendations.kubernetes.cluster-cpu', 'Cluster CPU · last 24h'),
        }
      : undefined,
    alert: showAlert
      ? {
          // The firing-alert count leads when present (matching the design); health rows follow as
          // the detail line. Without firing alerts the worst health row takes the lead instead.
          primary:
            alertsFiring > 0
              ? t('home.recommendations.kubernetes.alerts-firing', '{{value}} alerts firing', {
                  value: alertsFiring.toLocaleString(),
                })
              : healthRows[0],
          secondary: (alertsFiring > 0 ? healthRows : healthRows.slice(1)).join(' · ') || undefined,
          action: t('home.recommendations.kubernetes.view', 'View'),
          href: alertsHref,
        }
      : undefined,
    action: t('home.recommendations.kubernetes.action', 'Open K8s app'),
    href,
  };
}

export default function RecommendationExisting() {
  const styles = useStyles2(getStyles);
  const { settings } = usePluginBridge(KUBERNETES_APP_ID);
  // Resolved from Prometheus (kube-state-metrics), not a plugin REST endpoint — the k8s app has no
  // summary API. While loading or on error the entry is simply omitted and the stubs remain.
  const { value: overview } = useAsyncRetry(fetchKubernetesOverview, []);
  // Fetched separately so a missing cAdvisor metric only costs the chart, never the whole entry.
  const { value: cpuSeries } = useAsyncRetry(fetchClusterCpuSeries, []);

  // Track selection by title so it survives the Kubernetes item appearing once its data resolves;
  // storing the item object would go stale when the list is rebuilt.
  const [selectedTitle, setSelectedTitle] = useState<string>();

  const kubernetesItem =
    overview && overview.clusters > 0 ? buildKubernetesItem(overview, cpuSeries ?? null, settings) : null;
  const existing = kubernetesItem ? [kubernetesItem, ...stubbedExisting] : stubbedExisting;
  const selected = existing.find((item) => item.title === selectedTitle) ?? existing[0];

  if (!selected) {
    return null;
  }

  return (
    <Stack direction="column" justifyContent="space-between" gap={2} flex={1}>
      <Dropdown
        overlay={
          <Menu>
            <Menu.Group label={t('home.recommendations.switch', 'Switch to another app you run')}>
              {existing.map((item) => (
                <Menu.Item
                  key={item.title}
                  label={item.title}
                  icon={item.icon}
                  onClick={() => setSelectedTitle(item.title)}
                  active={item.title === selected.title}
                />
              ))}
            </Menu.Group>
          </Menu>
        }
      >
        <Button variant="secondary" fill="text" className={styles.dropdown}>
          <Stack direction="row" gap={1} alignItems="center">
            <div className={styles.icon}>
              <Icon name={selected.icon} size="lg" />
            </div>

            <Stack direction="column" gap={0}>
              <Text variant="bodySmall" color="secondary">
                <span className={styles.subtitle}>
                  <Trans i18nKey="home.recommendations.existing">Enabled solution</Trans>
                </span>
              </Text>

              <Stack direction="row" gap={0.5} alignItems="center">
                <Text variant="h4" color="primary" role="heading" aria-level={3}>
                  {selected.title}
                </Text>

                <Icon name="angle-down" className={styles.chevron} />
              </Stack>
            </Stack>
          </Stack>
        </Button>
      </Dropdown>

      <Stack direction="column" gap={2}>
        <Stack direction="row" alignItems="baseline" columnGap={0.5} rowGap={0} wrap="wrap">
          <Text variant="h2" color="primary">
            {selected.stats.primary}
          </Text>

          <Text variant="body" color="secondary">
            &middot; {selected.stats.secondary}
          </Text>
        </Stack>

        {selected.sparkline && <SolutionSparkline sparkline={selected.sparkline} />}

        {selected.alert && (
          <div className={styles.alert}>
            <Stack direction="row" alignItems="center" gap={1}>
              <Icon name="exclamation-triangle" size="md" className={styles.warning} />

              <Stack direction="row" alignItems="center" columnGap={0.5} rowGap={0} flex="1 1 auto" wrap="wrap">
                <Text variant="body" color="primary">
                  {selected.alert.primary}
                </Text>

                {selected.alert.secondary && (
                  <Text variant="body" color="secondary">
                    &middot; {selected.alert.secondary}
                  </Text>
                )}
              </Stack>

              <LinkButton
                variant="secondary"
                size="sm"
                fill="text"
                icon="angle-right"
                iconPlacement="right"
                href={selected.alert.href}
              >
                {selected.alert.action}
              </LinkButton>
            </Stack>
          </div>
        )}
      </Stack>

      <Stack direction="row" alignItems="center" gap={1}>
        <LinkButton
          variant="secondary"
          size="md"
          fill="solid"
          icon="arrow-right"
          iconPlacement="right"
          href={selected.href}
        >
          {selected.action}
        </LinkButton>
      </Stack>
    </Stack>
  );
}

function SolutionSparkline({ sparkline }: { sparkline: NonNullable<ExistingItem['sparkline']> }) {
  const theme = useTheme2();
  // Measure the container directly (ResizeObserver); a bare flex child gives AutoSizer width 0.
  const [measureRef, { width }] = useMeasure<HTMLDivElement>();

  // Blue line with a soft gradient fill, matching the design. Memoized so Sparkline (memo) is stable.
  const sparklineConfig = useMemo<FieldConfig<GraphFieldConfig>>(
    () => ({
      color: { mode: 'fixed', fixedColor: 'blue' },
      custom: {
        lineWidth: 2,
        fillOpacity: 30,
        gradientMode: GraphGradientMode.Opacity,
        lineInterpolation: LineInterpolation.Smooth,
      },
    }),
    []
  );

  return (
    <Stack direction="column" gap={0}>
      <div ref={measureRef} style={{ height: SPARKLINE_HEIGHT }}>
        {/* width is 0 until ResizeObserver reports; Sparkline throws in uPlot at width 0. */}
        {width > 0 && (
          <Sparkline
            width={width}
            height={SPARKLINE_HEIGHT}
            sparkline={sparkline.series}
            config={sparklineConfig}
            theme={theme}
          />
        )}
      </div>
      <Text variant="bodySmall" color="secondary">
        {sparkline.caption}
      </Text>
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  dropdown: css({
    alignSelf: 'flex-start',
    height: 'auto',
    padding: theme.spacing(1),
    margin: theme.spacing(-1),
    textAlign: 'left',

    '&:hover': {
      borderColor: theme.colors.border.medium,
    },
  }),
  chevron: css({
    color: theme.colors.text.secondary,

    '[aria-expanded="true"] &': {
      transform: 'rotate(180deg)',
    },
  }),
  icon: css({
    background: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    color: theme.colors.text.secondary,
    padding: theme.spacing(1.5),
    lineHeight: 0,
  }),
  subtitle: css({
    textTransform: 'uppercase',
    letterSpacing: theme.spacing(0.125),
    opacity: 0.75,
  }),
  alert: css({
    background: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    padding: theme.spacing(1),
  }),
  warning: css({
    color: theme.colors.warning.main,
    margin: theme.spacing(0, 0, 0, 0.5),
  }),
});
