import { render, screen } from 'test/test-utils';

import { EnabledSolutionCard } from './EnabledSolutionCard';
import { fetchClusterCpuSeries, type KubernetesOverview } from './kubernetesData';

// Keep the real computeHealth (the health strip is driven by it); only stub the async CPU series.
jest.mock('./kubernetesData', () => ({
  ...jest.requireActual('./kubernetesData'),
  fetchClusterCpuSeries: jest.fn(),
}));

const mockFetchClusterCpuSeries = jest.mocked(fetchClusterCpuSeries);

function overview(partial: Partial<KubernetesOverview> = {}): KubernetesOverview {
  return {
    clusters: 3,
    pods: 100,
    unhealthyPods: null,
    restarts1h: null,
    notReadyNodes: null,
    ...partial,
  };
}

beforeEach(() => {
  // Default to "metric absent" so the sparkline is omitted; tests still assert the reserved height.
  mockFetchClusterCpuSeries.mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('EnabledSolutionCard', () => {
  it('formats cluster and pod counts with locale thousands separators', async () => {
    render(
      <EnabledSolutionCard overview={overview({ clusters: 1200, pods: 34567 })} canAccessKubernetesHome={false} />
    );

    // toLocaleString (en-US test env) inserts the separators; a raw String(count) would read "1200"/"34567".
    expect(await screen.findByText('1,200')).toBeInTheDocument();
    expect(screen.getByText(/34,567 pods/)).toBeInTheDocument();
  });

  it('hides the "Open Kubernetes app" link without access and shows it with access', async () => {
    const { rerender } = render(<EnabledSolutionCard overview={overview()} canAccessKubernetesHome={false} />);

    expect(await screen.findByText('Kubernetes Monitoring')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open kubernetes app/i })).not.toBeInTheDocument();

    rerender(<EnabledSolutionCard overview={overview()} canAccessKubernetesHome={true} />);

    expect(screen.getByRole('link', { name: /open kubernetes app/i })).toBeInTheDocument();
  });

  it('reserves the sparkline height and renders its caption even when the CPU series is null', async () => {
    // AutoSizer reports width 0 in jsdom, so the Sparkline never mounts — the layout must not collapse
    // and the caption must still render. Asserting a canvas here would be a jsdom artifact, not a contract.
    const { container } = render(<EnabledSolutionCard overview={overview()} canAccessKubernetesHome={false} />);

    expect(await screen.findByText('Cluster CPU · last 24h')).toBeInTheDocument();
    expect(container.querySelector('div[style*="height: 56"]')).toBeInTheDocument();
  });

  it('shows only the health rows whose raw signal is > 0, ceiling fractional counts', async () => {
    // restarts1h 0.4 keeps computeHealth at 'warning' (a real signal) and must display as "1", not round to 0.
    // unhealthyPods 0 and notReadyNodes null are not real signals -> no row for either.
    render(
      <EnabledSolutionCard
        overview={overview({ clusters: 3, pods: 100, unhealthyPods: 0, restarts1h: 0.4, notReadyNodes: null })}
        canAccessKubernetesHome={false}
      />
    );

    expect(await screen.findByText('1 restarts in the last hour')).toBeInTheDocument();
    expect(screen.queryByText(/pods pending or failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nodes not ready/)).not.toBeInTheDocument();
  });

  it('renders no health strip when every signal is healthy', async () => {
    // All signals present and zero -> severity 'healthy' -> strip suppressed entirely.
    render(
      <EnabledSolutionCard
        overview={overview({ clusters: 3, pods: 100, unhealthyPods: 0, restarts1h: 0, notReadyNodes: 0 })}
        canAccessKubernetesHome={false}
      />
    );

    expect(await screen.findByText('Kubernetes Monitoring')).toBeInTheDocument();
    expect(screen.queryByText(/pods pending or failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/restarts in the last hour/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nodes not ready/)).not.toBeInTheDocument();
  });
});
