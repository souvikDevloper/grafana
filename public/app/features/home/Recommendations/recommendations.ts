import { type IconName } from '@grafana/data';
import { t } from '@grafana/i18n';

export interface Recommendation {
  id: string; // stable telemetry id (recommendation_id)
  pluginId: string; // app plugin id — drives the CTA href AND the installed-filter
  icon: IconName;
  title: string; // e.g. "Hosted Traces"
  heading: string; // e.g. "Trace requests across services"
  description: string;
  items: [string, string]; // exactly 2 checklist lines
  ctaLabel: string; // "Enable Hosted Traces"
  docsHref: string; // absolute https:// docs URL
}

/**
 * Curated recommendations surfaced alongside the enabled Kubernetes solution. Calls `t` at render
 * time (never at module load) so translations resolve after i18n init — invoke inside a component.
 */
export function getRecommendations(): Recommendation[] {
  return [
    {
      id: 'hosted-traces',
      pluginId: 'grafana-exploretraces-app',
      icon: 'gf-traces',
      title: t('home.recommendations.hosted-traces.title', 'Hosted Traces'),
      heading: t('home.recommendations.hosted-traces.heading', 'Trace requests across services'),
      description: t(
        'home.recommendations.hosted-traces.description',
        'Add distributed tracing to see how requests flow between services and where they slow down.'
      ),
      items: [
        t('home.recommendations.hosted-traces.item-1', 'Trace every request — no sampling required to start'),
        t('home.recommendations.hosted-traces.item-2', 'Jump from a slow span to its logs and metrics'),
      ],
      ctaLabel: t('home.recommendations.hosted-traces.cta', 'Enable Hosted Traces'),
      docsHref: 'https://grafana.com/docs/grafana-cloud/send-data/traces/',
    },
    {
      id: 'synthetic-monitoring',
      pluginId: 'grafana-synthetic-monitoring-app',
      icon: 'globe',
      title: t('home.recommendations.synthetic-monitoring.title', 'Synthetic Monitoring'),
      heading: t('home.recommendations.synthetic-monitoring.heading', 'Watch your services from outside'),
      description: t(
        'home.recommendations.synthetic-monitoring.description',
        'Add HTTP and DNS checks from 20+ global locations to catch outages before users do.'
      ),
      items: [
        t('home.recommendations.synthetic-monitoring.item-1', 'HTTP, DNS, TCP, traceroute, and browser checks'),
        t('home.recommendations.synthetic-monitoring.item-2', 'Run from 20+ public probes or your own private ones'),
      ],
      ctaLabel: t('home.recommendations.synthetic-monitoring.cta', 'Enable Synthetic Monitoring'),
      docsHref: 'https://grafana.com/docs/grafana-cloud/testing/synthetic-monitoring/',
    },
    {
      id: 'application-observability',
      pluginId: 'grafana-app-observability-app',
      icon: 'application-observability',
      title: t('home.recommendations.application-observability.title', 'Application Observability'),
      heading: t('home.recommendations.application-observability.heading', 'See service health at a glance'),
      description: t(
        'home.recommendations.application-observability.description',
        'Turn OpenTelemetry data into RED metrics, service maps, and correlated traces automatically.'
      ),
      items: [
        t('home.recommendations.application-observability.item-1', 'Auto-generated service maps and RED metrics'),
        t('home.recommendations.application-observability.item-2', 'Correlate traces, logs, and profiles in one place'),
      ],
      ctaLabel: t('home.recommendations.application-observability.cta', 'Enable Application Observability'),
      docsHref: 'https://grafana.com/docs/grafana-cloud/monitor-applications/application-observability/',
    },
    {
      id: 'frontend-observability',
      pluginId: 'grafana-kowalski-app',
      icon: 'frontend-observability',
      title: t('home.recommendations.frontend-observability.title', 'Frontend Observability'),
      heading: t('home.recommendations.frontend-observability.heading', 'Measure real user experience'),
      description: t(
        'home.recommendations.frontend-observability.description',
        'Capture Core Web Vitals and errors from the browser and tie them back to backend traces.'
      ),
      items: [
        t('home.recommendations.frontend-observability.item-1', 'Real user monitoring with Core Web Vitals'),
        t('home.recommendations.frontend-observability.item-2', 'Link frontend errors to backend traces'),
      ],
      ctaLabel: t('home.recommendations.frontend-observability.cta', 'Enable Frontend Observability'),
      docsHref: 'https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/',
    },
  ];
}
