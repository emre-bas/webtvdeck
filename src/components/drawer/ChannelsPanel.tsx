import { ChevronLeft, ChevronRight, Folder, FolderOpen, Search, SearchX, X } from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLanguage, useT } from '../../i18n';
import { useBackLayer } from '../../lib/back-stack';
import { filterByQuery, fold } from '../../lib/text';
import { activateChannel, play, selectGroup } from '../../store/actions';
import { useCurrentChannel, useFavoriteSet } from '../../store/hooks';
import { useSession } from '../../store/session';
import { EmptyState } from '../common';
import { CHANNEL_ROW_HEIGHT, ChannelRow } from './ChannelRow';
import { VirtualList, type VirtualListHandle } from './VirtualList';

const GROUP_ROW_HEIGHT = 52;

interface GroupItem {
  /** null = all channels, '' = channels without a group. */
  key: string | null;
  label: string;
  count: number;
}

export function ChannelsPanel() {
  const t = useT();
  const language = useLanguage();
  const channels = useSession((s) => s.channels);
  const index = useSession((s) => s.index);
  const group = useSession((s) => s.group);
  const loadState = useSession((s) => s.loadState);
  const drawerOpen = useSession((s) => s.drawerOpen);
  const current = useCurrentChannel();
  const favorites = useFavoriteSet();
  const [view, setView] = useState<'channels' | 'groups'>('channels');
  const [query, setQuery] = useState('');
  // Once the user switches views, focus follows into the new list.
  const [navigated, setNavigated] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<VirtualListHandle>(null);
  const search = useDeferredValue(query).trim();

  const visible = useMemo(() => {
    if (view === 'channels' && search) return filterByQuery(channels, index.searchKeys, search);
    return group === null ? channels : (index.byGroup.get(group) ?? []);
  }, [channels, index, group, search, view]);

  const groups = useMemo<GroupItem[]>(() => {
    const items: GroupItem[] = [
      { key: null, label: t('channels.all'), count: channels.length },
      ...index.groups.map((g) => ({ key: g.name, label: g.name || t('channels.ungrouped'), count: g.count })),
    ];
    if (view !== 'groups' || !search) return items;
    const needle = fold(search);
    return items.filter((item) => fold(item.label).includes(needle));
  }, [channels.length, index, search, view, t]);

  const playingIndex = useMemo(() => (current ? visible.findIndex((c) => c.url === current.url) : -1), [visible, current]);
  const groupIndex = groups.findIndex((item) => item.key === group);
  const groupLabel = group === null ? t('channels.all') : group || t('channels.ungrouped');

  function switchView(next: 'channels' | 'groups') {
    setQuery('');
    setView(next);
    setNavigated(true);
  }

  // Back (remote, gesture) and Escape leave the group picker before closing the menu.
  useBackLayer(drawerOpen && view === 'groups', () => switchView('channels'), 2);

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (view === 'groups') {
        const first = groups[0];
        if (first) chooseGroup(first);
      } else if (visible[0]) {
        play(visible[0], { zapList: visible });
      }
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  }

  function chooseGroup(item: GroupItem) {
    selectGroup(item.key);
    switchView('channels');
  }

  if (loadState === 'loading') {
    return (
      <div className="panel panel--center">
        <div className="spinner" aria-label={t('player.loadingChannels')} />
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__toolbar">
        <div className="search">
          <Search className="search__icon" aria-hidden="true" />
          <input
            ref={searchRef}
            className="input search__input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={view === 'groups' ? t('channels.searchGroups') : t('channels.search')}
            aria-label={view === 'groups' ? t('channels.searchGroups') : t('channels.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          {query && (
            <button type="button" className="search__clear" aria-label={t('channels.clearSearch')} onClick={() => setQuery('')}>
              <X />
            </button>
          )}
        </div>

        {view === 'groups' ? (
          <button type="button" className="group-button" onClick={() => switchView('channels')}>
            <ChevronLeft aria-hidden="true" />
            <span className="group-button__label">{t('channels.groups')}</span>
            <span className="group-button__count">{index.groups.length}</span>
          </button>
        ) : search ? (
          <p className="panel__summary">{t('channels.results', { count: visible.length })}</p>
        ) : (
          <button type="button" className="group-button" onClick={() => switchView('groups')}>
            <FolderOpen aria-hidden="true" />
            <span className="group-button__label">{groupLabel}</span>
            <span className="group-button__count">{visible.length.toLocaleString(language)}</span>
            <ChevronRight aria-hidden="true" />
          </button>
        )}
      </div>

      {view === 'groups' ? (
        <VirtualList
          key="groups"
          ref={listRef}
          items={groups}
          rowHeight={GROUP_ROW_HEIGHT}
          idPrefix="group"
          label={t('channels.groups')}
          initialIndex={groupIndex}
          autoFocus={navigated}
          onActivate={chooseGroup}
          onExitTop={() => searchRef.current?.focus()}
          onTypeAhead={() => searchRef.current?.focus()}
          empty={<EmptyState icon={SearchX} title={t('channels.noGroups')} />}
          renderRow={(item) => (
            <div className="group-row" data-selected={item.key === group || undefined}>
              <Folder aria-hidden="true" />
              <span className="group-row__label">{item.label}</span>
              <span className="group-row__count">{item.count.toLocaleString(language)}</span>
            </div>
          )}
        />
      ) : (
        <VirtualList
          key="channels"
          ref={listRef}
          items={visible}
          rowHeight={CHANNEL_ROW_HEIGHT}
          idPrefix="channel"
          label={t('tab.channels')}
          initialIndex={playingIndex}
          autoFocus={navigated}
          onActivate={(channel) => activateChannel(channel, visible)}
          onExitTop={() => searchRef.current?.focus()}
          onTypeAhead={() => searchRef.current?.focus()}
          empty={<EmptyState icon={SearchX} title={t('channels.noResults')} />}
          renderRow={(channel) => (
            <ChannelRow
              channel={channel}
              playing={channel.url === current?.url}
              favorite={favorites.has(channel.url)}
              showGroup={group === null || !!search}
            />
          )}
        />
      )}
    </div>
  );
}
