import { act, render, screen, userEvent, waitFor } from 'test/test-utils';

import { isAppPluginEnabled } from '@grafana/runtime';
import { contextSrv } from 'app/core/services/context_srv';
import { usePluginBridge } from 'app/features/alerting/unified/hooks/usePluginBridge';

import Recommendations from './Recommendations';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  isAppPluginEnabled: jest.fn(),
}));

jest.mock('app/features/alerting/unified/hooks/usePluginBridge', () => ({
  ...jest.requireActual('app/features/alerting/unified/hooks/usePluginBridge'),
  usePluginBridge: jest.fn(),
}));

// The RecommendationExisting child fetches its overview from Prometheus; resolve to an empty
// cluster so tests exercise the (deterministic) stub entries instead of hitting a datasource.
jest.mock('./kubernetesData', () => ({
  ...jest.requireActual('./kubernetesData'),
  fetchKubernetesOverview: jest.fn().mockResolvedValue({
    clusters: 0,
    pods: 0,
    alertsFiring: null,
    unhealthyPods: null,
    restarts1h: null,
    notReadyNodes: null,
  }),
  fetchClusterCpuSeries: jest.fn().mockResolvedValue(null),
}));

const mockUsePluginBridge = jest.mocked(usePluginBridge);
const mockIsAppPluginEnabled = jest.mocked(isAppPluginEnabled);

beforeEach(() => {
  window.localStorage.clear();
  mockUsePluginBridge.mockReturnValue({ loading: false, installed: true });
  // All recommended apps disabled by default → every recommendation shows.
  mockIsAppPluginEnabled.mockResolvedValue(false);
  jest.spyOn(contextSrv, 'hasPermission').mockReturnValue(true);
});

afterEach(() => jest.restoreAllMocks());

describe('Recommendations', () => {
  it('renders nothing while plugin data is loading', async () => {
    mockUsePluginBridge.mockReturnValue({ loading: true });

    const { container } = render(<Recommendations />);

    // waitFor flushes the enabled-lookup state update inside act; the gate must keep rendering null.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing when Kubernetes Monitoring is not installed', async () => {
    mockUsePluginBridge.mockReturnValue({ loading: false, installed: false });

    const { container } = render(<Recommendations />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing when the user cannot manage plugins', async () => {
    jest.mocked(contextSrv.hasPermission).mockReturnValue(false);
    jest.spyOn(contextSrv, 'hasRole').mockReturnValue(false);

    const { container } = render(<Recommendations />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('drops recommendations whose app is already enabled', async () => {
    mockIsAppPluginEnabled.mockImplementation(
      async (id) => id === 'grafana-exploretraces-app' || id === 'grafana-synthetic-monitoring-app'
    );

    render(<Recommendations />);

    // findBy flushes the enabled lookup and the RecommendationExisting overview fetch inside act.
    expect(await screen.findByRole('link', { name: /Enable Application Observability/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Enable Hosted Traces/ })).not.toBeInTheDocument();
  });

  it('collapses and expands the recommendations card', async () => {
    const { user } = render(<Recommendations />);

    expect(await screen.findByText('Recommendations for your stack')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide' }));

    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show' }));

    expect(screen.getByText('Recommendations for your stack')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument();
  });

  it('loads the collapsed state from local storage', async () => {
    window.localStorage.setItem('grafana.home.recommendations.collapsed', 'true');
    render(<Recommendations />);

    expect(await screen.findByRole('button', { name: 'Show' })).toBeInTheDocument();
    expect(screen.getByText('Recommendations for your stack')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('navigates recommendations with previous/next buttons', async () => {
    const { user } = render(<Recommendations />);

    const getVisibleHeading = () =>
      screen.getAllByRole('heading', { level: 3 }).find((heading) => heading.closest('div[aria-hidden="false"]'));
    const getVisibleTitle = () => getVisibleHeading()?.textContent?.trim() ?? '';
    const getVisibleSlide = () => getVisibleHeading()?.closest('div[aria-hidden="false"]');

    // The enabled lookup resolves async; wait for the carousel before reading slides.
    await screen.findByRole('button', { name: 'Next' });

    const initialVisibleSlide = getVisibleSlide();
    const initialVisibleTitle = getVisibleTitle();

    expect(initialVisibleSlide).toBeInTheDocument();
    expect(getVisibleHeading()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(getVisibleSlide()).toBeInTheDocument();
    expect(getVisibleSlide()).not.toBe(initialVisibleSlide);
    expect(getVisibleTitle()).not.toBe(initialVisibleTitle);
    expect(getVisibleHeading()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous' }));

    expect(getVisibleSlide()).toBe(initialVisibleSlide);
    expect(getVisibleTitle()).toBe(initialVisibleTitle);
    expect(getVisibleHeading()).toBeInTheDocument();
  });

  it('navigates recommendations with dots', async () => {
    const { user } = render(<Recommendations />);

    expect(await screen.findByRole('button', { name: 'Go to recommendation 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to recommendation 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to recommendation 3' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to recommendation 3' }));

    expect(screen.getByRole('button', { name: 'Go to recommendation 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to recommendation 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to recommendation 3' })).not.toBeInTheDocument();
  });

  it('pauses by default when reduced motion is preferred', async () => {
    const matchMediaSpy = jest.spyOn(window, 'matchMedia').mockImplementation(
      () =>
        ({
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          matches: true,
        }) as unknown as MediaQueryList
    );

    try {
      render(<Recommendations />);

      // findBy flushes the RecommendationExisting overview fetch inside act before asserting.
      expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    } finally {
      matchMediaSpy.mockRestore();
    }
  });

  it('pauses and resumes autoplay', async () => {
    jest.useFakeTimers();

    try {
      render(<Recommendations />);
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      const pauseButton = await screen.findByRole('button', { name: 'Pause' });
      await user.click(pauseButton);

      expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(6000);
      });

      expect(screen.queryByRole('button', { name: 'Go to recommendation 1' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Resume' }));

      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(6000);
      });

      expect(screen.getByRole('button', { name: 'Go to recommendation 1' })).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
