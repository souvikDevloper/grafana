import { css } from '@emotion/css';
import { useMemo } from 'react';
import { useAsyncRetry, useMeasure } from 'react-use';

import { type FieldConfig, type GrafanaTheme2, locationUtil } from '@grafana/data';
import { t, Trans } from '@grafana/i18n';
import { type GraphFieldConfig, GraphGradientMode, LineInterpolation } from '@grafana/schema';
import { Icon, LinkButton, Sparkline, Stack, Text, useStyles2, useTheme2 } from '@grafana/ui';
import { createBridgeURL } from 'app/features/alerting/unified/components/PluginBridge';

import { computeHealth, fetchClusterCpuSeries, KUBERNETES_APP_ID, type KubernetesOverview } from './kubernetesData';

const SPARKLINE_HEIGHT = 56;

interface Props {
  overview: KubernetesOverview;
  canAccessKubernetesHome: boolean;
}

export function EnabledSolutionCard({ overview, canAccessKubernetesHome }: Props) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const { value: series } = useAsyncRetry(fetchClusterCpuSeries, []);
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

  // Wrap the raw /a/... bridge path so copy-link / open-in-new-tab is correct under config.appSubUrl.
  const kubernetesHref = locationUtil.assureBaseUrl(createBridgeURL(KUBERNETES_APP_ID, '/home'));

  const health = computeHealth(overview);
  const showHealth = health !== null && health.severity !== 'healthy';

  // Filter on the RAW signal (>0), display with Math.ceil: a 0.4 restart signal keeps computeHealth at
  // 'warning' but must not round to "0 restarts", and increase() yields fractions we never want to show.
  const healthRows: string[] = [];
  if (showHealth) {
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
  }

  return (
    <Stack direction="column" gap={2} height="100%">
      <Text variant="bodySmall" color="secondary">
        <Trans i18nKey="home.recommendations.enabled-solution">ENABLED SOLUTION</Trans>
      </Text>

      <Text variant="h4">
        <Trans i18nKey="home.recommendations.solution-name">Kubernetes Monitoring</Trans>
      </Text>

      <Stack alignItems="baseline" gap={1}>
        <Text variant="h2">{overview.clusters.toLocaleString()}</Text>
        <Text variant="h2" color="secondary">
          <Trans i18nKey="home.recommendations.clusters-label">clusters</Trans>
        </Text>
        <Text color="secondary">
          <Trans i18nKey="home.recommendations.pods-count">· {{ value: overview.pods.toLocaleString() }} pods</Trans>
        </Text>
      </Stack>

      <Stack direction="column" gap={0}>
        <div ref={measureRef} style={{ height: SPARKLINE_HEIGHT }}>
          {/* width is 0 until ResizeObserver reports; Sparkline throws in uPlot at width 0. */}
          {width > 0 && series ? (
            <Sparkline
              width={width}
              height={SPARKLINE_HEIGHT}
              sparkline={series}
              config={sparklineConfig}
              theme={theme}
            />
          ) : null}
        </div>
        <Text variant="bodySmall" color="secondary">
          <Trans i18nKey="home.recommendations.cluster-cpu">Cluster CPU · last 24h</Trans>
        </Text>
      </Stack>

      {/* Health strip + primary action sit at the bottom so the CTA aligns with the sibling card's. */}
      <div className={styles.footer}>
        {showHealth && healthRows.length > 0 && (
          <div className={styles.healthStrip}>
            <Stack alignItems="center" justifyContent="space-between" gap={1}>
              <Stack alignItems="center" gap={1}>
                <Icon name="exclamation-triangle" className={styles.warningIcon} />
                <Text color="secondary">{healthRows.join(' · ')}</Text>
              </Stack>
              {canAccessKubernetesHome && (
                <LinkButton variant="secondary" fill="text" size="sm" href={kubernetesHref}>
                  <Trans i18nKey="home.recommendations.view">View</Trans>
                </LinkButton>
              )}
            </Stack>
          </div>
        )}

        {canAccessKubernetesHome && (
          // Row wrapper so the button sizes to its content instead of stretching the column width.
          <Stack>
            <LinkButton variant="secondary" fill="outline" href={kubernetesHref}>
              <Trans i18nKey="home.recommendations.open-k8s">Open Kubernetes app</Trans>
            </LinkButton>
          </Stack>
        )}
      </div>
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  // Pushed to the bottom of the (equal-height) column so the CTA lines up with the sibling card.
  footer: css({
    marginTop: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  healthStrip: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1, 1.5),
  }),
  warningIcon: css({
    color: theme.colors.warning.main,
    flexShrink: 0,
  }),
});
