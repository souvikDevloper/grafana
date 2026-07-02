import { css } from '@emotion/css';
import { useState } from 'react';
import { useAsyncRetry } from 'react-use';

import { type IconName, type GrafanaTheme2, type PluginMeta, locationUtil } from '@grafana/data';
import { t, Trans } from '@grafana/i18n';
import { Button, Dropdown, Icon, LinkButton, Menu, Stack, Text, useStyles2 } from '@grafana/ui';
import { createBridgeURL } from 'app/features/alerting/unified/components/PluginBridge';
import { canAccessPluginPage, usePluginBridge } from 'app/features/alerting/unified/hooks/usePluginBridge';

import { computeHealth, fetchKubernetesOverview, KUBERNETES_APP_ID, type KubernetesOverview } from './kubernetesData';

interface ExistingItem {
  title: string;
  icon: IconName;
  stats: {
    primary: string;
    secondary: string;
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
function buildKubernetesItem(overview: KubernetesOverview, settings?: PluginMeta<{}>): ExistingItem | null {
  const bridgePath = createBridgeURL(KUBERNETES_APP_ID, '/home');
  if (!settings || !canAccessPluginPage(settings, bridgePath)) {
    return null;
  }
  // Wrap the raw /a/... bridge path so copy-link / open-in-new-tab is correct under config.appSubUrl.
  const href = locationUtil.assureBaseUrl(bridgePath);

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

  const health = computeHealth(overview);
  const showAlert = health !== null && health.severity !== 'healthy' && healthRows.length > 0;

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
    alert: showAlert
      ? {
          primary: healthRows[0],
          secondary: healthRows.length > 1 ? healthRows.slice(1).join(' · ') : undefined,
          action: t('home.recommendations.kubernetes.view', 'View'),
          href,
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

  // Track selection by title so it survives the Kubernetes item appearing once its data resolves;
  // storing the item object would go stale when the list is rebuilt.
  const [selectedTitle, setSelectedTitle] = useState<string>();

  const kubernetesItem = overview && overview.clusters > 0 ? buildKubernetesItem(overview, settings) : null;
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
