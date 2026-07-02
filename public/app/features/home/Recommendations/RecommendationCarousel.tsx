import { css } from '@emotion/css';
import { useEffect, useState } from 'react';
import { useMedia } from 'react-use';

import { type GrafanaTheme2 } from '@grafana/data';
import { t, Trans } from '@grafana/i18n';
import { Badge, IconButton, Stack, Text, useStyles2 } from '@grafana/ui';

import { RecommendationCard } from './RecommendationCard';
import { type Recommendation } from './recommendations';

interface Props {
  recommendations: Recommendation[];
}

const AUTO_ADVANCE_MS = 6000;

export function RecommendationCarousel({ recommendations }: Props) {
  const styles = useStyles2(getStyles);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');

  const count = recommendations.length;

  // Clamp on the render itself, not via useEffect: if the list shrinks (an app gets enabled) while
  // `index` is past the new end, reading recommendations[index] would be undefined before an effect fires.
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;

  // Auto-advance through the cards; pause on hover/focus and honor reduced-motion. Wraps at the end,
  // so the arrows below also wrap (no disabled "ends") to stay consistent with the looping motion.
  useEffect(() => {
    if (paused || reducedMotion || count <= 1) {
      return;
    }
    const id = setInterval(() => setIndex((i) => (i + 1) % count), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [paused, reducedMotion, count]);

  if (count === 0) {
    return null;
  }

  const goTo = (i: number) => setIndex(((i % count) + count) % count);

  return (
    <Stack
      direction="column"
      gap={2}
      height="100%"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <Stack alignItems="center" justifyContent="space-between">
        <Stack alignItems="center" gap={1}>
          <Badge color="orange" icon="bolt" text={t('home.recommendations.recommended', 'Recommended')} />
          <Text color="secondary">
            <Trans i18nKey="home.recommendations.with-kubernetes">with Kubernetes</Trans>
          </Text>
        </Stack>
        <Stack alignItems="center" gap={1}>
          <IconButton
            name="angle-left"
            aria-label={t('home.recommendations.prev', 'Previous recommendation')}
            onClick={() => goTo(safeIndex - 1)}
          />
          <div className={styles.dots}>
            {recommendations.map((rec, i) => (
              <button
                key={rec.id}
                type="button"
                className={i === safeIndex ? styles.dotActive : styles.dot}
                aria-label={t('home.recommendations.go-to', 'Show {{title}}', { title: rec.title })}
                aria-current={i === safeIndex}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
          <IconButton
            name="angle-right"
            aria-label={t('home.recommendations.next', 'Next recommendation')}
            onClick={() => goTo(safeIndex + 1)}
          />
        </Stack>
      </Stack>

      <RecommendationCard recommendation={recommendations[safeIndex]} />
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => {
  const dotBase = css({
    width: 8,
    height: 8,
    padding: 0,
    borderRadius: theme.shape.radius.circle,
    border: 'none',
    cursor: 'pointer',
  });
  return {
    dots: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    dot: css(dotBase, {
      backgroundColor: theme.colors.border.strong,
    }),
    dotActive: css(dotBase, {
      backgroundColor: theme.colors.text.primary,
    }),
  };
};
