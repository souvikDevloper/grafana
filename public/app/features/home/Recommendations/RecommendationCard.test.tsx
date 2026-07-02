import { render, screen } from 'test/test-utils';

import { type GrafanaConfig, locationUtil } from '@grafana/data';
import { contextSrv } from 'app/core/services/context_srv';
import { AccessControlAction } from 'app/types/accessControl';

import { recommendationEnableClicked } from '../analytics/main';

import { RecommendationCard } from './RecommendationCard';
import { getRecommendations } from './recommendations';

jest.mock('../analytics/main', () => ({ recommendationEnableClicked: jest.fn() }));
const mockEnableClicked = jest.mocked(recommendationEnableClicked);

// The first curated recommendation ("Hosted Traces") is the fixture: it exercises the CTA href,
// telemetry id, and docs link in one card.
const recommendation = getRecommendations()[0];

function initLocation(appSubUrl = '') {
  // locationUtil.assureBaseUrl reads a module-local config; initialize it (repo convention) so the
  // CTA href reflects appSubUrl without mutating the shared runtime config object.
  locationUtil.initialize({
    config: { appSubUrl } as GrafanaConfig,
    getVariablesUrlParams: () => ({}),
    getTimeRangeForUrl: () => ({ from: 'now-6h', to: 'now' }),
  });
}

beforeAll(() => initLocation());

afterEach(() => {
  jest.restoreAllMocks();
  mockEnableClicked.mockClear();
  // Reset any subpath a test set so it does not leak into later tests.
  initLocation();
});

describe('RecommendationCard', () => {
  it('renders a subpath-correct Enable CTA and fires telemetry on click when the user can install plugins', async () => {
    jest.spyOn(contextSrv, 'hasPermission').mockImplementation((a) => a === AccessControlAction.PluginsInstall);
    jest.spyOn(contextSrv, 'hasRole').mockReturnValue(false);
    initLocation('/grafana');

    const { user } = render(<RecommendationCard recommendation={recommendation} />);

    const cta = screen.getByRole('link', { name: 'Enable Hosted Traces' });
    // locationUtil.assureBaseUrl must prepend config.appSubUrl to the /plugins/:pluginId/ install route.
    expect(cta).toHaveAttribute('href', '/grafana/plugins/grafana-exploretraces-app/');

    // LinkButton is a plain <a href>; jsdom would attempt (unimplemented) navigation on click and log an
    // error that failOnConsole treats as a failure. Cancel the default so only React's onClick (telemetry) runs.
    cta.addEventListener('click', (e) => e.preventDefault());
    await user.click(cta);

    expect(mockEnableClicked).toHaveBeenCalledTimes(1);
    expect(mockEnableClicked).toHaveBeenCalledWith({ recommendation_id: 'hosted-traces' });
  });

  it('always renders the Learn more docs link as a sanitized external link, even without install rights', () => {
    jest.spyOn(contextSrv, 'hasPermission').mockReturnValue(false);
    jest.spyOn(contextSrv, 'hasRole').mockReturnValue(false);

    render(<RecommendationCard recommendation={recommendation} />);

    const docs = screen.getByRole('link', { name: /learn more/i });
    expect(docs).toHaveAttribute('href', recommendation.docsHref);
    expect(docs).toHaveAttribute('target', '_blank');
    expect(docs).toHaveAttribute('rel', 'noreferrer');
  });

  it('hides the Enable CTA when the user has neither the plugin permission nor an admin role', () => {
    jest.spyOn(contextSrv, 'hasPermission').mockReturnValue(false);
    jest.spyOn(contextSrv, 'hasRole').mockReturnValue(false);

    render(<RecommendationCard recommendation={recommendation} />);

    expect(screen.queryByRole('link', { name: 'Enable Hosted Traces' })).not.toBeInTheDocument();
    // The docs link is the always-present, non-dead-end fallback.
    expect(screen.getByRole('link', { name: /learn more/i })).toBeInTheDocument();
  });

  it('shows the Enable CTA for a legacy Admin lacking the plugin permission (route-access parity)', () => {
    jest.spyOn(contextSrv, 'hasPermission').mockReturnValue(false);
    jest.spyOn(contextSrv, 'hasRole').mockImplementation((r) => r === 'Admin');

    render(<RecommendationCard recommendation={recommendation} />);

    // /plugins/:pluginId/ grants access to Admin/ServerAdmin roles, so the CTA must not be hidden from them.
    expect(screen.getByRole('link', { name: 'Enable Hosted Traces' })).toBeInTheDocument();
  });
});
