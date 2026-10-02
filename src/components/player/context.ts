import { createContext, useContext, useSyncExternalStore } from 'react';
import type { PlayerController, PlayerState } from '../../player/controller';

export const PlayerContext = createContext<PlayerController | null>(null);

export function usePlayer(): PlayerController {
  const controller = useContext(PlayerContext);
  if (!controller) throw new Error('usePlayer must be used inside <PlayerContext>');
  return controller;
}

export function usePlayerState(): PlayerState {
  const controller = usePlayer();
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
