import { css } from '@emotion/css';
import { useId, useState } from 'react';
import Skeleton from 'react-loading-skeleton';
import { useAsyncRetry } from 'react-use';

import { type GrafanaTheme2, type PluginMeta } from '@grafana/data';
import { Trans } from '@grafana/i18n';
import { useAppPluginMetas } from '@grafana/runtime/internal';
import { Icon, Stack, Text, useStyles2 } from '@grafana/ui';
import { createBridgeURL } from 'app/features/alerting/unified/components/PluginBridge';
import { canAccessPluginPage, usePluginBridge } from 'app/features/alerting/unified/hooks/usePluginBridge';

import { HomeSection } from '../HomeSection';

import { EnabledSolutionCard } from './EnabledSolutionCard';
import { RecommendationCarousel } from './RecommendationCarousel';
import { fetchKubernetesOverview, KUBERNETES_APP_ID, type KubernetesOverview } from './kubernetesData';
import { getRecommendations, type Recommendation } from './recommendations';

/**
 * "Do more with Grafana" — the enabled Kubernetes solution summary plus a carousel of curated
 * recommendations. Self-gates to null unless Kubernetes is installed, resolves clusters > 0, and at
 * least one recommendation is not already enabled. Split into three components so the Prometheus
 * query never runs for non-Kubernetes users and no hook runs after a conditional return.
 */
export function RecommendationsSection() {
  const { installed, loading: bridgeLoading, settings } = usePluginBridge(KUBERNETES_APP_ID);
  // Same source as config.apps but via the sanctioned accessor (config.apps is lint-forbidden);
  // drops already-enabled apps so the section never recommends what the user already runs.
  const { value: appMetas, loading: appsLoading } = useAppPluginMetas();

  // Hide (not skeleton) during load so the homepage never flashes a section that then vanishes.
  if (bridgeLoading || appsLoading || !installed) {
    return null;
  }

  const installedIds = new Set((appMetas ?? []).map((app) => app.id));
  const recommendations = getRecommendations().filter((r) => !installedIds.has(r.pluginId));
  if (recommendations.length === 0) {
    return null;
  }

  return <RecommendationsSectionData settings={settings} recommendations={recommendations} />;
}

interface DataProps {
  settings?: PluginMeta<{}>;
  recommendations: Recommendation[];
}

function RecommendationsSectionData({ settings, recommendations }: DataProps) {
  const { value, loading, error } = useAsyncRetry(fetchKubernetesOverview, []);

  if (loading) {
    return (
      <HomeSection>
        <Skeleton height={220} />
      </HomeSection>
    );
  }

  // A broken "Do more" panel is worse than none: hide on error or when no clusters resolve.
  if (error || !value || value.clusters === 0) {
    return null;
  }

  const canAccessKubernetesHome = settings
    ? canAccessPluginPage(settings, createBridgeURL(KUBERNETES_APP_ID, '/home'))
    : false;

  return (
    <RecommendationsSectionPanel
      overview={value}
      canAccessKubernetesHome={canAccessKubernetesHome}
      recommendations={recommendations}
    />
  );
}

interface PanelProps {
  overview: KubernetesOverview;
  canAccessKubernetesHome: boolean;
  recommendations: Recommendation[];
}

function RecommendationsSectionPanel({ overview, canAccessKubernetesHome, recommendations }: PanelProps) {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(true);
  const bodyId = useId();

  return (
    <Stack direction="column" gap={2}>
      {/* Heading + toggle sit on the page background, above the bordered panel. */}
      <Stack alignItems="center" justifyContent="space-between">
        <Text element="h2" variant="h4">
          <Trans i18nKey="home.recommendations.title">Do more with Grafana</Trans>
        </Text>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          <Stack alignItems="center" gap={1}>
            <Text color="secondary">
              {open ? (
                <Trans i18nKey="home.recommendations.hide">Hide</Trans>
              ) : (
                <Trans i18nKey="home.recommendations.show">Show</Trans>
              )}
            </Text>
            <Icon name={open ? 'angle-up' : 'angle-down'} aria-hidden />
          </Stack>
        </button>
      </Stack>

      {open && (
        <div id={bodyId} className={styles.panel}>
          <div className={styles.solutionColumn}>
            <EnabledSolutionCard overview={overview} canAccessKubernetesHome={canAccessKubernetesHome} />
          </div>
          <div className={styles.recommendationsColumn}>
            <RecommendationCarousel recommendations={recommendations} />
          </div>
        </div>
      )}
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  toggle: css({
    background: 'none',
    border: 'none',
    padding: theme.spacing(0.5),
    cursor: 'pointer',
    color: 'inherit',
  }),
  // One bordered panel; overflow hidden so the two column backgrounds clip to the rounded corners.
  panel: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    display: 'grid',
    gridTemplateColumns: '1fr',
    [theme.breakpoints.up('md')]: {
      gridTemplateColumns: '1fr 1fr',
    },
  }),
  // Right column stands out slightly against the left; divider between them. Flex column so the
  // card/carousel fill the equal-height grid cell and their CTAs bottom-align.
  solutionColumn: css({
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.colors.background.primary,
    padding: theme.spacing(3),
  }),
  recommendationsColumn: css({
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.colors.background.secondary,
    padding: theme.spacing(3),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    [theme.breakpoints.up('md')]: {
      borderTop: 'none',
      borderLeft: `1px solid ${theme.colors.border.weak}`,
    },
  }),
});
