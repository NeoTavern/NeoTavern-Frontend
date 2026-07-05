import type { ChatMetadata } from '../../../../types';
import type { ExtensionAPI } from '../../../../types/ExtensionAPI';
import type { DeepPartial } from '../../../../types/utils';

type ExtraRecord = Record<string, unknown>;
type ExtensionChat<TChatExtra, TMessageExtra> = ExtensionAPI<ExtraRecord, TChatExtra, TMessageExtra>['chat'];
type ExtraKey<TExtra> = Extract<keyof TExtra, string>;
type ExtraPatch<TExtra, TKey extends ExtraKey<TExtra>> = Partial<NonNullable<TExtra[TKey]>>;

type MessageExtraAPI<TMessageExtra = ExtraRecord> = {
  chat: Pick<ExtensionChat<ExtraRecord, TMessageExtra>, 'getHistory' | 'updateMessageObject'>;
};

type ChatExtraAPI<TChatExtra = ExtraRecord> = {
  chat: Pick<ExtensionChat<TChatExtra, ExtraRecord>, 'metadata'>;
};

type ChatExtraReader = {
  chat: {
    metadata: {
      get: () => { extra?: ExtraRecord } | null;
    };
  };
};

export function getMessageExtra<TMessageExtra, TKey extends ExtraKey<TMessageExtra>>(
  message: { extra?: TMessageExtra },
  extensionKey: TKey,
): TMessageExtra[TKey] | undefined {
  return message.extra?.[extensionKey];
}

export async function setMessageExtra<TMessageExtra, TKey extends ExtraKey<TMessageExtra> = ExtraKey<TMessageExtra>>(
  api: MessageExtraAPI<TMessageExtra>,
  index: number,
  extensionKey: TKey,
  value: TMessageExtra[TKey],
): Promise<void> {
  const message = api.chat.getHistory()[index];
  await api.chat.updateMessageObject(index, {
    extra: {
      ...message?.extra,
      [extensionKey]: value,
    } as DeepPartial<(typeof message)['extra']>,
  });
}

export async function mergeMessageExtra<TMessageExtra, TKey extends ExtraKey<TMessageExtra> = ExtraKey<TMessageExtra>>(
  api: MessageExtraAPI<TMessageExtra>,
  index: number,
  extensionKey: TKey,
  patch: ExtraPatch<TMessageExtra, TKey>,
): Promise<void> {
  const message = api.chat.getHistory()[index];
  const existing = (message?.extra?.[extensionKey] as ExtraRecord | undefined) ?? {};
  await setMessageExtra(api, index, extensionKey, { ...existing, ...patch } as TMessageExtra[TKey]);
}

export async function clearMessageExtra<TMessageExtra, TKey extends ExtraKey<TMessageExtra> = ExtraKey<TMessageExtra>>(
  api: MessageExtraAPI<TMessageExtra>,
  index: number,
  extensionKey: TKey,
): Promise<void> {
  await setMessageExtra(api, index, extensionKey, undefined as TMessageExtra[TKey]);
}

export function getChatExtra<TExtra>(api: ChatExtraReader, extensionKey: string): TExtra | undefined;
export function getChatExtra<TChatExtra, TKey extends ExtraKey<TChatExtra>>(
  api: ChatExtraAPI<TChatExtra>,
  extensionKey: TKey,
): TChatExtra[TKey] | undefined;
export function getChatExtra<TExtra>(api: ChatExtraReader, extensionKey: string): TExtra | undefined {
  return api.chat.metadata.get()?.extra?.[extensionKey] as TExtra | undefined;
}

export function setChatExtra<TChatExtra, TKey extends ExtraKey<TChatExtra> = ExtraKey<TChatExtra>>(
  api: ChatExtraAPI<TChatExtra>,
  extensionKey: TKey,
  value: TChatExtra[TKey],
): void {
  const currentExtra = api.chat.metadata.get()?.extra ?? {};
  api.chat.metadata.update({
    extra: {
      ...currentExtra,
      [extensionKey]: value,
    } as DeepPartial<ChatMetadata<TChatExtra>['extra']>,
  });
}

export function mergeChatExtra<TChatExtra, TKey extends ExtraKey<TChatExtra> = ExtraKey<TChatExtra>>(
  api: ChatExtraAPI<TChatExtra>,
  extensionKey: TKey,
  patch: ExtraPatch<TChatExtra, TKey>,
): void {
  const existing = (getChatExtra(api, extensionKey) as ExtraRecord | undefined) ?? {};
  setChatExtra(api, extensionKey, { ...existing, ...patch } as TChatExtra[TKey]);
}

export function clearChatExtra<TChatExtra, TKey extends ExtraKey<TChatExtra> = ExtraKey<TChatExtra>>(
  api: ChatExtraAPI<TChatExtra>,
  extensionKey: TKey,
): void {
  const metadata = api.chat.metadata.get();
  if (!metadata) return;
  const extra = { ...(metadata.extra ?? {}) };
  delete extra[extensionKey];
  api.chat.metadata.set({ ...metadata, extra } as ChatMetadata<TChatExtra>);
}
