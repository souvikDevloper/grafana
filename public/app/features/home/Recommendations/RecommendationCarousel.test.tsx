import { useMedia } from 'react-use';
import { act, fireEvent, render, screen } from 'test/test-utils';

import { RecommendationCarousel } from './RecommendationCarousel';
import { getRecommendations } from './recommendations';

// RecommendationCard (rendered inside the carousel body) fires telemetry via this module; stub it so
// no real feature-event pipeline runs while we page through cards.
jest.mock('../analytics/main', () => ({ recommendationEnableClicked: jest.fn() }));

// The carousel reads the reduced-motion preference via `useMedia` to decide whether to auto-advance.
// Mock only that hook so we can turn the interval on/off deterministically per test.
jest.mock('react-use', () => ({
  ...jest.requireActual('react-use'),
  useMedia: jest.fn(),
}));

const recommendations = getRecommendations();
const first = 'Trace requests across services'; // Hosted Traces
const second = 'Watch your services from outside'; // Synthetic Monitoring
const last = 'Measure real user experience'; // Frontend Observability

describe('RecommendationCarousel', () => {
  beforeEach(() => {
    // Reduced-motion ON by default → auto-advance is disabled, so manual navigation and wrap-around
    // assertions run under real timers with no interval racing the userEvent interactions.
    jest.mocked(useMedia).mockReturnValue(true);
  });

  it('renders the first card with both arrows always enabled (never disabled)', () => {
    render(<RecommendationCarousel recommendations={recommendations} />);

    expect(screen.getByRole('heading', { name: first })).toBeInTheDocument();
    // Arrows now wrap, so neither end is ever disabled.
    expect(screen.getByRole('button', { name: 'Previous recommendation' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next recommendation' })).toBeEnabled();
  });

  it('advances first → second and moves aria-current to the Synthetic Monitoring dot when Next is clicked', async () => {
    const { user } = render(<RecommendationCarousel recommendations={recommendations} />);

    expect(screen.getByRole('button', { name: 'Show Hosted Traces' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Show Synthetic Monitoring' })).toHaveAttribute('aria-current', 'false');

    await user.click(screen.getByRole('button', { name: 'Next recommendation' }));

    expect(screen.getByRole('heading', { name: second })).toBeInTheDocument();
    expect(screen.getByText('Synthetic Monitoring')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: first })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Hosted Traces' })).toHaveAttribute('aria-current', 'false');
    expect(screen.getByRole('button', { name: 'Show Synthetic Monitoring' })).toHaveAttribute('aria-current', 'true');
  });

  it('wraps from the last card back to the first when Next is clicked past the end', async () => {
    const { user } = render(<RecommendationCarousel recommendations={recommendations} />);

    const next = screen.getByRole('button', { name: 'Next recommendation' });
    // Walk to the last card.
    for (let i = 0; i < recommendations.length - 1; i++) {
      await user.click(next);
    }
    expect(screen.getByRole('heading', { name: last })).toBeInTheDocument();

    // One more Next wraps around to the first card (goTo uses modulo).
    await user.click(next);
    expect(screen.getByRole('heading', { name: first })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: last })).not.toBeInTheDocument();
  });

  it('wraps from the first card to the last when Previous is clicked at index 0', async () => {
    const { user } = render(<RecommendationCarousel recommendations={recommendations} />);

    expect(screen.getByRole('heading', { name: first })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous recommendation' }));

    expect(screen.getByRole('heading', { name: last })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: first })).not.toBeInTheDocument();
  });

  it('clamps a stale index when the list shrinks past it, rendering the last valid card without crashing', async () => {
    const { user, rerender } = render(<RecommendationCarousel recommendations={recommendations} />);

    // Page to the last index (3), then shrink the list to 2 items so the stored index is out of range.
    const next = screen.getByRole('button', { name: 'Next recommendation' });
    for (let i = 0; i < recommendations.length - 1; i++) {
      await user.click(next);
    }
    expect(screen.getByRole('heading', { name: last })).toBeInTheDocument();

    rerender(<RecommendationCarousel recommendations={recommendations.slice(0, 2)} />);

    // safeIndex = min(3, 1) = 1 → the last valid card renders; no undefined-access crash.
    expect(screen.getByRole('heading', { name: second })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: last })).not.toBeInTheDocument();
  });

  describe('auto-advance', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('advances to the next card after AUTO_ADVANCE_MS when motion is allowed', () => {
      // Motion allowed → the setInterval runs.
      jest.mocked(useMedia).mockReturnValue(false);

      render(<RecommendationCarousel recommendations={recommendations} />);
      expect(screen.getByRole('heading', { name: first })).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(6000);
      });

      expect(screen.getByRole('heading', { name: second })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: first })).not.toBeInTheDocument();
    });

    it('does not auto-advance while the pointer is over the carousel (paused)', () => {
      jest.mocked(useMedia).mockReturnValue(false);

      const { container } = render(<RecommendationCarousel recommendations={recommendations} />);
      expect(screen.getByRole('heading', { name: first })).toBeInTheDocument();

      // Hovering the carousel pauses auto-advance. React derives onMouseEnter from native mouseover.
      const carousel = container.firstElementChild!;
      act(() => {
        fireEvent.mouseOver(carousel);
      });

      act(() => {
        jest.advanceTimersByTime(6000);
      });

      // Still on the first card: the interval was cleared when paused.
      expect(screen.getByRole('heading', { name: first })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: second })).not.toBeInTheDocument();
    });
  });
});
