import { atom } from 'nanostores';
import { SendOnEnterOptions } from '../constants';
import { isMobile } from '../utils/browser';

export const powerUser = atom<{
  external_media_forbidden_overrides: Array<string>;
  external_media_allowed_overrides: Array<string>;
  forbid_external_media: boolean;
  world_import_dialog: boolean;
  send_on_enter: number;
  never_resize_avatars: boolean;
}>({
  world_import_dialog: true,
  send_on_enter: SendOnEnterOptions.AUTO,
  never_resize_avatars: false,
  external_media_forbidden_overrides: [],
  external_media_allowed_overrides: [],
  forbid_external_media: false,
});

export function shouldSendOnEnter() {
  const resolvedPowerUser = powerUser.get();

  switch (resolvedPowerUser.send_on_enter) {
    case SendOnEnterOptions.DISABLED:
      return false;
    case SendOnEnterOptions.AUTO:
      return !isMobile();
    case SendOnEnterOptions.ENABLED:
      return true;
  }
}
