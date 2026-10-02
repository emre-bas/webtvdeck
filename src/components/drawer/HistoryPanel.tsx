import { History, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { formatRelativeTime, useLanguage, useT } from '../../i18n';
import type { Channel } from '../../lib/types';
import { activateChannel } from '../../store/actions';
import { useCurrentChannel, useFavoriteSet } from '../../store/hooks';
import { useLibrary, type HistoryEntry } from '../../store/library';
import { useSession } from '../../store/session';
import { EmptyState } from '../common';
import { CHANNEL_ROW_HEIGHT, ChannelRow } from './ChannelRow';
import { VirtualList } from './VirtualList';

const NO_ENTRIES: HistoryEntry[] = [];

export function HistoryPanel() {
  const t = useT();
  const language = useLanguage();
  const playlistId = useSession((s) => s.playlistId);
  const index = useSession((s) => s.index);
  const entries = useLibrary((s) => (playlistId ? (s.history[playlistId] ?? NO_ENTRIES) : NO_ENTRIES));
  const clearHistory = useLibrary((s) => s.clearHistory);
  const favorites = useFavoriteSet();
  const current = useCurrentChannel();

  const items = useMemo(
    () => entries.flatMap((entry): { channel: Channel; at: number }[] => {
      const channel = index.byUrl.get(entry.url);
      return channel ? [{ channel, at: entry.at }] : [];
    }),
    [entries, index],
  );
  const channels = useMemo(() => items.map((item) => item.channel), [items]);

  return (
    <div className="panel">
      <VirtualList
        items={items}
        rowHeight={CHANNEL_ROW_HEIGHT}
        idPrefix="history"
        label={t('tab.history')}
        onActivate={({ channel }) => activateChannel(channel, channels)}
        empty={<EmptyState icon={History} title={t('history.empty')} hint={t('history.emptyHint')} />}
        renderRow={({ channel, at }) => (
          <ChannelRow
            channel={channel}
            playing={channel.url === current?.url}
            favorite={favorites.has(channel.url)}
            meta={formatRelativeTime(at, language)}
            metaFirst
          />
        )}
      />
      {items.length > 0 && playlistId && (
        <div className="panel__footer">
          <button type="button" className="btn btn--small" onClick={() => clearHistory(playlistId)}>
            <Trash2 aria-hidden="true" />
            {t('history.clear')}
          </button>
        </div>
      )}
    </div>
  );
}
