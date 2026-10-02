import { X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { formatClockTime, useLanguage, useT } from '../../i18n';
import { useBackLayer } from '../../lib/back-stack';
import { useClock } from '../../lib/clock';
import { nowNext, progressOf, scheduleFor, upcoming } from '../../lib/epg/lookup';
import type { Channel } from '../../lib/types';
import { toggleInfo } from '../../store/actions';
import { useGuide } from '../../store/guide';
import { IconButton } from '../common';

/** What's on now and next on the current channel, like a remote's INFO button. */
export function InfoPanel({ channel }: { channel: Channel }) {
  const t = useT();
  const language = useLanguage();
  const guide = useGuide((s) => s.data);
  const updating = useGuide((s) => s.updating);
  const now = useClock();
  const schedule = scheduleFor(guide, channel);
  const { current } = nowNext(schedule, now, channel.tvgShift);
  const later = upcoming(schedule, now, channel.tvgShift, 5);

  // Back (remote, gesture) closes the panel like Escape does; it's only mounted while open.
  useBackLayer(true, () => toggleInfo(false), 3);

  return (
    <section className="info-panel" aria-label={t('guide.info')}>
      <header className="info-panel__head">
        <p className="info-panel__label">{t('guide.now')}</p>
        <IconButton label={t('common.close')} onClick={() => toggleInfo(false)}>
          <X />
        </IconButton>
      </header>

      {current ? (
        <div className="info-panel__current">
          <h2>{current.title}</h2>
          <p className="info-panel__time">
            {formatClockTime(current.start, language)} – {formatClockTime(current.stop, language)} ·{' '}
            {t('guide.remaining', { count: Math.max(1, Math.round((current.stop - now) / 60_000)) })}
          </p>
          <span className="info-panel__progress" style={{ '--progress': progressOf(current, now) } as CSSProperties} />
          {current.category && <span className="badge">{current.category}</span>}
          {current.desc && <p className="info-panel__desc">{current.desc}</p>}
        </div>
      ) : (
        <p className="info-panel__empty">{updating ? t('guide.updating') : t('guide.noData')}</p>
      )}

      {later.length > 0 && (
        <>
          <p className="info-panel__label">{t('guide.later')}</p>
          <ol className="info-panel__list">
            {later.map((programme) => (
              <li key={programme.start}>
                <time dateTime={new Date(programme.start).toISOString()}>{formatClockTime(programme.start, language)}</time>
                <span>{programme.title}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
