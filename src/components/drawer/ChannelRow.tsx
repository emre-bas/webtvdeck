import { AudioLines, Star } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useT } from '../../i18n';
import { useClock } from '../../lib/clock';
import { nowNext, progressOf, scheduleFor } from '../../lib/epg/lookup';
import type { Channel } from '../../lib/types';
import { toggleFavorite } from '../../store/actions';
import { useGuide } from '../../store/guide';
import { ChannelLogo } from '../ChannelLogo';

export const CHANNEL_ROW_HEIGHT = 64;

interface ChannelRowProps {
  channel: Channel;
  playing: boolean;
  favorite: boolean;
  /** Show the channel's group to the right of its name (lists that mix groups). */
  showGroup?: boolean;
  /** Second line when the guide has nothing on air for the channel. */
  meta?: ReactNode;
  /** Prefer `meta` over the programme on air (e.g. "watched 5 minutes ago"). */
  metaFirst?: boolean;
}

export function ChannelRow({ channel, playing, favorite, showGroup = false, meta, metaFirst = false }: ChannelRowProps) {
  const t = useT();
  const guide = useGuide((s) => s.data);
  const now = useClock();
  const onAir = metaFirst ? undefined : nowNext(scheduleFor(guide, channel), now, channel.tvgShift).current;

  return (
    <div className="ch-row" data-playing={playing || undefined}>
      <span className="ch-row__num">{channel.num}</span>
      <ChannelLogo channel={channel} size={40} />
      <span className="ch-row__text">
        <span className="ch-row__title">
          <span className="ch-row__name">{channel.name}</span>
          {showGroup && channel.group && <span className="ch-row__group">{channel.group}</span>}
        </span>
        {onAir ? (
          <>
            <span className="ch-row__meta ch-row__meta--programme">{onAir.title}</span>
            <span className="ch-row__progress" style={{ '--progress': progressOf(onAir, now) } as CSSProperties} />
          </>
        ) : (
          meta && <span className="ch-row__meta">{meta}</span>
        )}
      </span>
      {playing && <AudioLines className="ch-row__playing" aria-hidden="true" />}
      <button
        type="button"
        tabIndex={-1}
        className="ch-row__fav"
        data-on={favorite || undefined}
        aria-label={favorite ? t('controls.unfavorite') : t('controls.favorite')}
        onClick={(event) => {
          event.stopPropagation();
          toggleFavorite(channel);
        }}
      >
        <Star fill={favorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}
