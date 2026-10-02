import { Star } from 'lucide-react';
import { useMemo } from 'react';
import { useT } from '../../i18n';
import type { Channel } from '../../lib/types';
import { activateChannel } from '../../store/actions';
import { useCurrentChannel, useFavoriteUrls } from '../../store/hooks';
import { useSession } from '../../store/session';
import { EmptyState } from '../common';
import { CHANNEL_ROW_HEIGHT, ChannelRow } from './ChannelRow';
import { VirtualList } from './VirtualList';

export function FavoritesPanel() {
  const t = useT();
  const urls = useFavoriteUrls();
  const index = useSession((s) => s.index);
  const current = useCurrentChannel();

  // Favorites whose stream disappeared from the playlist are skipped until it comes back.
  const items = useMemo(
    () => urls.flatMap((url): Channel[] => {
      const channel = index.byUrl.get(url);
      return channel ? [channel] : [];
    }),
    [urls, index],
  );
  const playingIndex = current ? items.findIndex((c) => c.url === current.url) : -1;

  return (
    <div className="panel">
      <VirtualList
        items={items}
        rowHeight={CHANNEL_ROW_HEIGHT}
        idPrefix="favorite"
        label={t('tab.favorites')}
        initialIndex={playingIndex}
        onActivate={(channel) => activateChannel(channel, items)}
        empty={<EmptyState icon={Star} title={t('favorites.empty')} hint={t('favorites.emptyHint')} />}
        renderRow={(channel) => (
          <ChannelRow channel={channel} playing={channel.url === current?.url} favorite meta={channel.group} />
        )}
      />
    </div>
  );
}
