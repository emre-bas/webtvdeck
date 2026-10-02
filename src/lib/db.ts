import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GuideData } from './epg/xmltv';
import type { Channel } from './types';

export interface StoredGuide {
  playlistId: string;
  url: string;
  fetchedAt: number;
  programmes: number;
  data: GuideData;
}

interface LibrarySchema extends DBSchema {
  channels: {
    key: string;
    value: { playlistId: string; channels: Channel[]; savedAt: number };
  };
  guides: {
    key: string;
    value: StoredGuide;
  };
}

let connection: Promise<IDBPDatabase<LibrarySchema>> | null = null;

/** Channel lists and guides can be tens of megabytes, far beyond what localStorage takes. */
function db(): Promise<IDBPDatabase<LibrarySchema>> {
  connection ??= openDB<LibrarySchema>('iptv', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore('channels', { keyPath: 'playlistId' });
      if (oldVersion < 2) database.createObjectStore('guides', { keyPath: 'playlistId' });
    },
    blocking() {
      // Another tab is upgrading the schema; step aside and reconnect on next use.
      const stale = connection;
      connection = null;
      void stale?.then((database) => database.close());
    },
  });
  return connection;
}

export async function saveChannels(playlistId: string, channels: Channel[]): Promise<void> {
  await (await db()).put('channels', { playlistId, channels, savedAt: Date.now() });
}

export async function loadChannels(playlistId: string): Promise<Channel[] | null> {
  const record = await (await db()).get('channels', playlistId);
  return record?.channels ?? null;
}

export async function saveGuide(guide: StoredGuide): Promise<void> {
  await (await db()).put('guides', guide);
}

export async function loadGuide(playlistId: string): Promise<StoredGuide | null> {
  return (await (await db()).get('guides', playlistId)) ?? null;
}

export async function deletePlaylistData(playlistId: string): Promise<void> {
  const database = await db();
  await Promise.all([database.delete('channels', playlistId), database.delete('guides', playlistId)]);
}

export async function clearDatabase(): Promise<void> {
  const database = await db();
  await Promise.all([database.clear('channels'), database.clear('guides')]);
}
