import { default_avatar } from '../constants';
import type { ThumbnailType } from '../types';
import { usePersonaStore } from '../stores/persona.store';

export function getThumbnailUrl(type: ThumbnailType, file: string | undefined): string {
  if (!file || file === 'none') {
    return default_avatar;
  }
  const personaStore = usePersonaStore();
  const timestamp = personaStore.lastAvatarUpdate;
  return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}&t=${timestamp}`;
}
