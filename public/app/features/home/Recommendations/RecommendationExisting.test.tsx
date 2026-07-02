import { render, screen, within } from 'test/test-utils';

import { type PluginMeta } from '@grafana/data';
import { usePluginBridge } from 'app/features/alerting/unified/hooks/usePluginBridge';

import RecommendationExisting from './RecommendationExisting';
import { fetchKubernetesOverview, type KubernetesOverview } from './kubernetesData';

jest.mock('app/features/alerting/unified/hooks/usePluginBridge', () => ({
  ...jest.requireActual('app/features/alerting/unified/hooks/usePluginBridge'),
  usePluginBridge: jest.fn(),
}));

jest.mock('./kubernetesData', () => ({
  ...jest.requireActual('./kubernetesData'),
  fetchKubernetesOverview: jest.fn(),
}));

const mockUsePluginBridge = jest.mocked(usePluginBridge);
const mockFetchOverview = jest.mocked(fetchKubernetesOverview);

// No `includes` entry for the bridge path means canAccessPluginPage grants access.
const settings = { id: 'grafana-k8s-app' } as PluginMeta<{}>;

const healthyOverview: KubernetesOverview = {
  clusters: 3,
  pods: 247,
  unhealthyPods: 0,
  restarts1h: 0,
  notReadyNodes: 0,
};

beforeEach(() => {
  mockUsePluginBridge.mockReturnValue({ loading: false, installed: true, settings });
  mockFetchOverview.mockResolvedValue(healthyOverview);
});

afterEach(() => jest.restoreAllMocks());

describe('RecommendationExisting', () => {
  it('opens the dropdown and switches the selected solution', async () => {
    const { user } = render(<RecommendationExisting />);

    const trigger = screen.getByRole('button');
    const initialLabel = within(trigger).getByRole('heading').textContent?.trim() ?? '';
    expect(initialLabel).not.toBe('');

    await user.click(trigger);

    expect(await screen.findByRole('menu')).toBeInTheDocument();
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBeGreaterThan(1);

    const nextItem = menuItems.find((item) => (item.textContent?.trim() ?? '') !== initialLabel);
    expect(nextItem).toBeDefined();

    const nextLabel = nextItem?.textContent?.trim() ?? '';
    expect(nextLabel).not.toBe('');

    await user.click(nextItem!);

    expect(within(trigger).getByRole('heading', { name: nextLabel })).toBeInTheDocument();
    expect(within(trigger).queryByRole('heading', { name: initialLabel })).not.toBeInTheDocument();
  });

  it('shows the Kubernetes entry with live stats once the overview resolves', async () => {
    render(<RecommendationExisting />);

    expect(await screen.findByRole('heading', { name: 'Kubernetes Monitoring' })).toBeInTheDocument();
    expect(screen.getByText('3 clusters')).toBeInTheDocument();
    expect(screen.getByText(/247 pods/)).toBeInTheDocument();
    // Healthy cluster — no alert strip.
    expect(screen.queryByText(/pods pending or failed/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open K8s app/ })).toHaveAttribute('href', '/a/grafana-k8s-app/home');
  });

  it('shows an alert strip when the cluster reports problems', async () => {
    mockFetchOverview.mockResolvedValue({
      clusters: 3,
      pods: 247,
      unhealthyPods: 2,
      restarts1h: 14,
      notReadyNodes: null,
    });

    render(<RecommendationExisting />);

    expect(await screen.findByText('2 pods pending or failed')).toBeInTheDocument();
    expect(screen.getByText(/14 restarts in the last hour/)).toBeInTheDocument();
  });

  it('falls back to the stubbed solutions when no clusters resolve', async () => {
    mockFetchOverview.mockResolvedValue({ ...healthyOverview, clusters: 0 });

    const { user } = render(<RecommendationExisting />);

    const trigger = screen.getByRole('button');
    await user.click(trigger);

    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.queryByText('Kubernetes Monitoring')).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });
});
