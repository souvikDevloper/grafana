import { render, screen, waitFor } from 'test/test-utils';

import { type AppPluginConfig, type PluginMeta } from '@grafana/data';
import { useAppPluginMetas } from '@grafana/runtime/internal';
import { canAccessPluginPage, usePluginBridge } from 'app/features/alerting/unified/hooks/usePluginBridge';

import { RecommendationsSection } from './RecommendationsSection';
import { fetchClusterCpuSeries, fetchKubernetesOverview, type KubernetesOverview } from './kubernetesData';

jest.mock('app/features/alerting/unified/hooks/usePluginBridge', () => ({
  ...jest.requireActual('app/features/alerting/unified/hooks/usePluginBridge'),
  usePluginBridge: jest.fn(),
  canAccessPluginPage: jest.fn(),
}));

jest.mock('@grafana/runtime/internal', () => ({
  ...jest.requireActual('@grafana/runtime/internal'),
  useAppPluginMetas: jest.fn(),
}));

// Keep computeHealth / KUBERNETES_APP_ID real; only stub the two data-fetching entry points.
jest.mock('./kubernetesData', () => ({
  ...jest.requireActual('./kubernetesData'),
  fetchKubernetesOverview: jest.fn(),
  fetchClusterCpuSeries: jest.fn(),
}));

const mockUsePluginBridge = jest.mocked(usePluginBridge);
const mockCanAccessPluginPage = jest.mocked(canAccessPluginPage);
const mockUseAppPluginMetas = jest.mocked(useAppPluginMetas);
const mockFetchKubernetesOverview = jest.mocked(fetchKubernetesOverview);
const mockFetchClusterCpuSeries = jest.mocked(fetchClusterCpuSeries);

// canAccessPluginPage is mocked, so only the truthiness of settings drives the access gate.
const SETTINGS = { includes: [] } as unknown as PluginMeta;

const ALL_FOUR_APPS = [
  { id: 'grafana-exploretraces-app' },
  { id: 'grafana-synthetic-monitoring-app' },
  { id: 'grafana-app-observability-app' },
  { id: 'grafana-kowalski-app' },
] as unknown as AppPluginConfig[];

function appMetas(value: AppPluginConfig[] | undefined, loading = false) {
  return { loading, error: undefined, value };
}

function setOverview(partial: Partial<KubernetesOverview> = {}) {
  mockFetchKubernetesOverview.mockResolvedValue({
    clusters: 3,
    pods: 120,
    unhealthyPods: null,
    restarts1h: null,
    notReadyNodes: null,
    ...partial,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Defaults: installed + access granted + no enabled apps + resolvable overview. Tests override.
  mockUsePluginBridge.mockReturnValue({ loading: false, installed: true, settings: SETTINGS });
  mockCanAccessPluginPage.mockReturnValue(true);
  mockUseAppPluginMetas.mockReturnValue(appMetas([]));
  mockFetchClusterCpuSeries.mockResolvedValue(null);
  setOverview();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RecommendationsSection', () => {
  it('renders nothing and never queries Prometheus when the Kubernetes app is not installed', () => {
    mockUsePluginBridge.mockReturnValue({ loading: false, installed: false });

    const { container } = render(<RecommendationsSection />);

    expect(container).toBeEmptyDOMElement();
    // The overview query lives in the inner component that must never mount for non-Kubernetes users.
    expect(mockFetchKubernetesOverview).not.toHaveBeenCalled();
  });

  it('renders nothing (no skeleton flash) while the plugin bridge is loading', () => {
    mockUsePluginBridge.mockReturnValue({ loading: true });

    const { container } = render(<RecommendationsSection />);

    expect(container).toBeEmptyDOMElement();
    expect(mockFetchKubernetesOverview).not.toHaveBeenCalled();
  });

  it('renders nothing when every recommended app is already enabled', () => {
    mockUseAppPluginMetas.mockReturnValue(appMetas(ALL_FOUR_APPS));

    const { container } = render(<RecommendationsSection />);

    expect(container).toBeEmptyDOMElement();
    // Filtered to empty before the data gate -> the overview is never fetched.
    expect(mockFetchKubernetesOverview).not.toHaveBeenCalled();
  });

  it('renders nothing when the overview resolves zero clusters', async () => {
    setOverview({ clusters: 0 });

    const { container } = render(<RecommendationsSection />);

    // Briefly shows a skeleton, then collapses to null once clusters:0 resolves.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockFetchKubernetesOverview).toHaveBeenCalled();
  });

  it('renders the section and carousel when installed, unfiltered, and clusters resolve', async () => {
    setOverview({ clusters: 3 });

    render(<RecommendationsSection />);

    expect(await screen.findByText('Do more with Grafana')).toBeInTheDocument();
    // The carousel and its first recommendation card are present.
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('Trace requests across services')).toBeInTheDocument();
  });
});
