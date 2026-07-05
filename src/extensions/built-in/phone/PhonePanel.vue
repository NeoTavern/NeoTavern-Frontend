<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Button, Select, Textarea } from '../../../components/UI';
import type { PhoneManager } from './index';
import {
  PHONE_UPDATED_EVENT,
  type PhoneContact,
  type PhoneExtensionAPI,
  type PhoneMessage,
  type PhoneMessageExtraData,
} from './types';

const props = defineProps<{
  api: PhoneExtensionAPI;
  manager: PhoneManager;
}>();

const t = props.api.i18n.t;
const contacts = ref<PhoneContact[]>([]);
const messageIndex = ref(0);
const selectedContactId = ref('');
const draft = ref('');
const loadingContacts = ref(false);
const sending = ref(false);
const activeScreen = ref<'list' | 'thread'>('list');

const history = computed(() => props.api.chat.getHistory());
const selectedMessage = computed(() => history.value[messageIndex.value] ?? null);
const selectedExtra = ref<PhoneMessageExtraData>({});

const messageOptions = computed(() =>
  history.value.map((message, index) => {
    const label = `${
      index === history.value.length - 1 ? t('extensionsBuiltin.phone.latest') : `#${index + 1}`
    } · ${message.name}: ${stripText(message.mes)}`;
    return { label, value: index };
  }),
);

const selectedContact = computed(
  () => contacts.value.find((contact) => contact.id === selectedContactId.value) ?? contacts.value[0] ?? null,
);

const activeConversation = computed(() => {
  if (!selectedContact.value) return null;
  return (
    selectedExtra.value.conversations?.find((conversation) => conversation.contactId === selectedContact.value?.id) ??
    null
  );
});

const threadMessages = computed<PhoneMessage[]>(() => {
  if (!activeConversation.value) return [];
  return (selectedExtra.value.messages ?? [])
    .filter((message) => message.conversationId === activeConversation.value?.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
});

const ownerLabel = computed(() => {
  if (!selectedMessage.value) return t('extensionsBuiltin.phone.noChatMessageSelected');
  const prefix =
    messageIndex.value === history.value.length - 1
      ? t('extensionsBuiltin.phone.attachedToLatestMessage')
      : t('extensionsBuiltin.phone.attachedToMessage', { index: messageIndex.value + 1 });
  return `${prefix}: ${stripText(selectedMessage.value.mes)}`;
});

const activeThreadTitle = computed(() => selectedContact.value?.displayName ?? t('extensionsBuiltin.phone.messages'));

function stripText(value: string): string {
  return (
    value
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90) || t('extensionsBuiltin.phone.emptyMessage')
  );
}

function getMessageExtra(): PhoneMessageExtraData {
  return props.manager.getMessageExtra(messageIndex.value);
}

async function refresh(): Promise<void> {
  contacts.value = props.manager.getContacts();
  if (!selectedContactId.value || !contacts.value.some((contact) => contact.id === selectedContactId.value)) {
    selectedContactId.value = contacts.value[0]?.id ?? '';
  }
  if (history.value.length > 0 && messageIndex.value >= history.value.length) {
    messageIndex.value = history.value.length - 1;
  }
  selectedExtra.value = getMessageExtra();
}

async function initContacts(): Promise<void> {
  loadingContacts.value = true;
  try {
    await props.manager.refreshContacts();
    await refresh();
  } finally {
    loadingContacts.value = false;
  }
}

async function send(): Promise<void> {
  if (!selectedContact.value || !draft.value.trim() || !selectedMessage.value) return;
  const body = draft.value;
  draft.value = '';
  sending.value = true;
  try {
    await props.manager.sendSms(messageIndex.value, selectedContact.value.id, body);
    await refresh();
  } finally {
    sending.value = false;
  }
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
}

async function deleteSms(message: PhoneMessage): Promise<void> {
  await props.manager.deleteSmsMessage(messageIndex.value, message.id);
  await refresh();
}

function openThread(contactId: string): void {
  selectedContactId.value = contactId;
  activeScreen.value = 'thread';
}

function backToList(): void {
  activeScreen.value = 'list';
}

function messageSpeaker(message: PhoneMessage): string {
  return message.direction === 'outbound'
    ? t('extensionsBuiltin.phone.you')
    : (selectedContact.value?.displayName ?? t('extensionsBuiltin.phone.contact'));
}

function latestMessageForContact(contactId: string): PhoneMessage | null {
  const conversation = selectedExtra.value.conversations?.find((item) => item.contactId === contactId);
  if (!conversation) return null;
  return (
    (selectedExtra.value.messages ?? [])
      .filter((message) => message.conversationId === conversation.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

function contactPreview(contact: PhoneContact): string {
  const latest = latestMessageForContact(contact.id);
  return latest?.body ?? contact.relationship ?? contact.handle;
}

function contactTime(contact: PhoneContact): string {
  const latest = latestMessageForContact(contact.id);
  if (!latest) return '';
  return new Date(latest.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function contactInitials(contact: PhoneContact): string {
  return contact.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

let unbindPhone: (() => void) | undefined;
let unbindChat: (() => void) | undefined;
let unbindMessage: (() => void) | undefined;

onMounted(async () => {
  messageIndex.value = props.manager.getDefaultMessageIndex();
  await refresh();
  unbindPhone = props.api.events.on(PHONE_UPDATED_EVENT, () => refresh());
  unbindChat = props.api.events.on('chat:entered', () => {
    messageIndex.value = props.manager.getDefaultMessageIndex();
    refresh();
  });
  unbindMessage = props.api.events.on('message:updated', () => refresh());
});

onBeforeUnmount(() => {
  unbindPhone?.();
  unbindChat?.();
  unbindMessage?.();
});

watch(messageIndex, () => {
  selectedExtra.value = getMessageExtra();
});
</script>

<template>
  <div class="phone-panel">
    <div class="phone-shell">
      <div class="phone-shell__bezel">
        <div class="android-status-bar">
          <span>9:41</span>
          <span class="android-status-bar__icons">
            <i class="fa-solid fa-signal"></i>
            <i class="fa-solid fa-wifi"></i>
            <i class="fa-solid fa-battery-three-quarters"></i>
          </span>
        </div>

        <main class="android-screen">
          <Transition :name="activeScreen === 'thread' ? 'android-slide' : 'android-slide-back'" mode="out-in">
            <section v-if="activeScreen === 'list'" key="list" class="android-page">
              <header class="android-app-bar android-app-bar--large">
                <div>
                  <strong>{{ t('extensionsBuiltin.phone.messages') }}</strong>
                  <span>{{ ownerLabel }}</span>
                </div>
                <button
                  class="android-icon-button"
                  type="button"
                  :title="t('extensionsBuiltin.phone.refreshContacts')"
                  @click="initContacts"
                >
                  <i :class="['fa-solid', loadingContacts ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles']"></i>
                </button>
              </header>

              <div class="phone-controls">
                <Select
                  v-model="messageIndex"
                  :options="messageOptions"
                  :title="t('extensionsBuiltin.phone.attachedMessage')"
                />
              </div>

              <div class="conversation-list">
                <button
                  v-for="contact in contacts"
                  :key="contact.id"
                  type="button"
                  class="conversation-row"
                  @click="openThread(contact.id)"
                >
                  <span class="contact-avatar" :style="{ backgroundColor: contact.avatarColor || undefined }">
                    {{ contactInitials(contact) }}
                  </span>
                  <span class="conversation-row__body">
                    <span class="conversation-row__title">
                      <strong>{{ contact.displayName }}</strong>
                      <small>{{ contactTime(contact) }}</small>
                    </span>
                    <small>{{ contactPreview(contact) }}</small>
                  </span>
                </button>

                <div v-if="contacts.length === 0" class="phone-empty">
                  <i class="fa-solid fa-address-book"></i>
                  <span>{{ t('extensionsBuiltin.phone.initializeContacts') }}</span>
                </div>
              </div>
            </section>

            <section v-else key="thread" class="android-page">
              <header class="android-app-bar">
                <button class="android-icon-button" type="button" :title="t('common.back')" @click="backToList">
                  <i class="fa-solid fa-arrow-left"></i>
                </button>
                <span
                  v-if="selectedContact"
                  class="contact-avatar contact-avatar--small"
                  :style="{ backgroundColor: selectedContact.avatarColor || undefined }"
                >
                  {{ contactInitials(selectedContact) }}
                </span>
                <div>
                  <strong>{{ activeThreadTitle }}</strong>
                  <span>{{
                    selectedContact?.relationship ?? selectedContact?.handle ?? t('extensionsBuiltin.phone.sms')
                  }}</span>
                </div>
              </header>

              <div class="message-list">
                <div v-if="threadMessages.length === 0" class="phone-empty">
                  <i class="fa-solid fa-comment-sms"></i>
                  <span>{{ t('extensionsBuiltin.phone.startSmsConversation') }}</span>
                </div>
                <article
                  v-for="message in threadMessages"
                  :key="message.id"
                  class="sms-bubble"
                  :class="`sms-bubble--${message.direction}`"
                >
                  <div class="sms-bubble__meta">
                    <span>{{ messageSpeaker(message) }}</span>
                    <button type="button" :title="t('extensionsBuiltin.phone.deleteSms')" @click="deleteSms(message)">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                  <p>{{ message.body }}</p>
                  <small>{{ message.status }}</small>
                </article>
                <div v-if="sending" class="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>

              <form class="sms-composer" @submit.prevent="send">
                <Textarea
                  v-model="draft"
                  :rows="1"
                  :placeholder="t('extensionsBuiltin.phone.textMessage')"
                  :disabled="!selectedContact || sending"
                  @keydown="handleComposerKeydown"
                />
                <Button
                  icon="fa-paper-plane"
                  :loading="sending"
                  :disabled="!draft.trim() || !selectedContact"
                  :title="t('extensionsBuiltin.phone.send')"
                />
              </form>
            </section>
          </Transition>
        </main>

        <div class="android-nav-bar">
          <span></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.phone-panel {
  height: 100%;
  overflow: hidden;
  background: var(--theme-background-tint);
  padding: var(--spacing-md);
}

.phone-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 430px;
  margin: 0 auto;
  overflow: hidden;
  border: 10px solid var(--black-70a);
  border-radius: 32px;
  background: var(--theme-chat-tint);
  box-shadow: 0 20px 60px var(--theme-shadow-color);
}

.phone-shell__bezel {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  background: var(--theme-chat-tint);
}

.android-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  flex: 0 0 28px;
  padding: 0 var(--spacing-md);
  color: var(--theme-text-color);
  font-size: 0.75rem;
  font-weight: 700;
  background: var(--theme-background-tint);
}

.android-status-bar__icons {
  display: flex;
  gap: var(--spacing-xs);
  align-items: center;
}

.android-screen {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--theme-chat-tint);
}

.android-page {
  display: flex;
  min-width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.android-app-bar {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  min-height: 56px;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-bottom: 1px solid var(--theme-border-color);
  color: var(--theme-text-color);
  background: var(--theme-background-tint);
}

.android-app-bar--large {
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 72px;
  padding: var(--spacing-sm) var(--spacing-md);
}

.android-app-bar > div,
.android-app-bar--large > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.android-app-bar strong,
.android-app-bar--large strong {
  overflow: hidden;
  font-size: 1.05rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.android-app-bar span,
.conversation-row small,
.sms-bubble small {
  overflow: hidden;
  color: var(--theme-emphasis-color);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.android-app-bar--large strong {
  font-size: 1.35rem;
}

.android-icon-button {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 0;
  border-radius: var(--base-border-radius-round);
  color: var(--theme-text-color);
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--animation-duration-sm),
    transform var(--animation-duration-xs);
}

.android-icon-button:hover {
  background: var(--white-20a);
}

.android-icon-button:active {
  transform: scale(0.94);
}

.phone-controls {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--black-20a);
}

.conversation-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-xs) 0 var(--spacing-md);
}

.contact-avatar {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  border-radius: 50%;
  background: var(--theme-quote-color);
  color: var(--white-100);
  font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--white-30a);
}

.contact-avatar--small {
  width: 36px;
  height: 36px;
  flex-basis: 36px;
  font-size: 0.8rem;
}

.conversation-row {
  position: relative;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  min-height: 72px;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 0;
  color: var(--theme-text-color);
  text-align: left;
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--animation-duration-sm),
    transform var(--animation-duration-xs);
}

.conversation-row::after {
  content: '';
  position: absolute;
  right: var(--spacing-md);
  bottom: 0;
  left: calc(48px + var(--spacing-md) + var(--spacing-sm));
  border-bottom: 1px solid var(--theme-border-color);
}

.conversation-row:hover {
  background: var(--white-20a);
}

.conversation-row:active {
  transform: scale(0.985);
}

.conversation-row__body {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.conversation-row__title {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.conversation-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-sm);
  overflow-y: auto;
  padding: var(--spacing-md);
  background: linear-gradient(var(--black-20a), var(--black-20a)), var(--theme-chat-tint);
}

.sms-bubble {
  max-width: min(72%, 520px);
  animation: bubble-in 180ms ease-out;
}

.sms-bubble--outbound {
  align-self: flex-end;
}

.sms-bubble--inbound {
  align-self: flex-start;
}

.sms-bubble p {
  margin: 0;
  padding: 10px 12px;
  border-radius: 20px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.sms-bubble--outbound p {
  border-bottom-right-radius: 6px;
  background: var(--color-accent-green-70a);
  color: var(--theme-text-color);
  border: 1px solid var(--color-accent-green);
}

.sms-bubble--inbound p {
  border-bottom-left-radius: 6px;
  background: var(--theme-bot-message-tint);
  color: var(--theme-text-color);
  border: 1px solid var(--theme-border-color);
}

.sms-bubble__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xs);
  margin-bottom: 3px;
  color: var(--theme-emphasis-color);
  font-size: 0.75rem;
}

.sms-bubble__meta button {
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.sms-composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  align-items: end;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-top: 1px solid var(--theme-border-color);
  background: var(--black-20a);
}

.sms-composer :deep(.textarea-wrapper textarea),
.sms-composer :deep(textarea) {
  min-height: 42px;
  max-height: 120px;
  border-radius: 22px;
}

.phone-empty {
  display: grid;
  place-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-lg);
  color: var(--theme-emphasis-color);
  text-align: center;
}

.typing-indicator {
  display: flex;
  align-items: center;
  width: max-content;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 18px;
  background: var(--theme-bot-message-tint);
  border: 1px solid var(--theme-border-color);
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: typing 900ms infinite ease-in-out;
  background: var(--theme-emphasis-color);
}

.typing-indicator span:nth-child(2) {
  animation-delay: 120ms;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 240ms;
}

.android-nav-bar {
  display: grid;
  place-items: center;
  height: 22px;
  flex: 0 0 22px;
  background: var(--theme-background-tint);
}

.android-nav-bar span {
  width: 104px;
  height: 4px;
  border-radius: 999px;
  background: var(--theme-emphasis-color);
  opacity: 0.75;
}

.android-slide-enter-active,
.android-slide-leave-active,
.android-slide-back-enter-active,
.android-slide-back-leave-active {
  transition:
    transform var(--animation-duration-md) cubic-bezier(0.2, 0, 0, 1),
    opacity var(--animation-duration-md) ease;
}

.android-slide-enter-from {
  opacity: 0.65;
  transform: translateX(24%);
}

.android-slide-leave-to {
  opacity: 0.65;
  transform: translateX(-18%);
}

.android-slide-back-enter-from {
  opacity: 0.65;
  transform: translateX(-18%);
}

.android-slide-back-leave-to {
  opacity: 0.65;
  transform: translateX(24%);
}

@keyframes bubble-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes typing {
  0%,
  80%,
  100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-4px);
  }
}

@media (max-width: 720px) {
  .phone-panel {
    padding: 0;
  }

  .phone-shell {
    border-width: 0;
    border-radius: 0;
    max-width: none;
  }

  .phone-shell__bezel {
    border-radius: 0;
  }

  .sms-bubble {
    max-width: 88%;
  }
}
</style>
