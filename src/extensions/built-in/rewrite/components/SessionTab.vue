<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '../../../../components/UI';
import { SplitPane } from '../../../../components/common';
import type { ExtensionAPI } from '../../../../types';
import type { FieldChange, RewriteField, RewriteSession, RewriteSettings } from '../types';
import SessionManager from './SessionManager.vue';
import SessionView from './SessionView.vue';

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
  sessions: RewriteSession[];
  activeSession: RewriteSession | null;
  isGenerating: boolean;
  initialFields: RewriteField[];
  latestSessionChanges: FieldChange[];
}>();

const emit = defineEmits<{
  newSession: [];
  loadSession: [id: string];
  deleteSession: [id: string];
  send: [text: string];
  deleteFrom: [msgId: string];
  editMessage: [msgId: string, newContent: string];
  applyChanges: [changes: FieldChange[]];
  showDiff: [changes: FieldChange[]];
  abort: [];
  regenerate: [];
  cancel: [];
  applyLatest: [];
  generalDiff: [];
}>();

const isSidebarCollapsed = ref(false);

const t = props.api.i18n.t;

function handleApplyLatest() {
  if (props.latestSessionChanges.length > 0) {
    emit('applyChanges', props.latestSessionChanges);
  }
}
</script>

<template>
  <div class="view-container session-mode">
    <SplitPane v-model:collapsed="isSidebarCollapsed" :initial-width="250" :min-width="200" :max-width="400">
      <template #side>
        <div class="session-sidebar">
          <SessionManager
            :sessions="sessions"
            :current-session-id="activeSession?.id"
            @new-session="emit('newSession')"
            @load-session="emit('loadSession', $event)"
            @delete-session="emit('deleteSession', $event)"
          />
        </div>
      </template>
      <template #main>
        <div class="session-main">
          <div v-if="activeSession" class="session-header-controls">
            <Button
              icon="fa-code-compare"
              :title="t('extensionsBuiltin.rewrite.popup.generalDiff')"
              :disabled="latestSessionChanges.length === 0"
              @click="emit('generalDiff')"
            >
              {{ t('extensionsBuiltin.rewrite.popup.diff') }}
            </Button>
          </div>

          <SessionView
            v-if="activeSession"
            :messages="activeSession.messages"
            :is-generating="isGenerating"
            :initial-fields="initialFields"
            :api="api"
            @send="emit('send', $event)"
            @delete-from="emit('deleteFrom', $event)"
            @edit-message="(msgId, newContent) => emit('editMessage', msgId, newContent)"
            @show-diff="emit('showDiff', $event)"
            @abort="emit('abort')"
            @regenerate="emit('regenerate')"
          />
          <div v-else class="empty-session-view">
            <p>{{ t('extensionsBuiltin.rewrite.session.selectSession') }}</p>
            <Button icon="fa-plus" @click="emit('newSession')">{{
              t('extensionsBuiltin.rewrite.session.newSession')
            }}</Button>
          </div>

          <!-- Footer for Session Tab -->
          <div class="session-footer">
            <div class="spacer"></div>
            <Button variant="ghost" @click="emit('cancel')">{{ t('common.close') }}</Button>
            <Button
              v-if="activeSession"
              variant="confirm"
              :disabled="!latestSessionChanges.length || isGenerating"
              @click="handleApplyLatest"
            >
              {{ t('extensionsBuiltin.rewrite.popup.apply') }}
            </Button>
          </div>
        </div>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped lang="scss">
.view-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;

  &.session-mode {
    flex-direction: row;
    border: 1px solid var(--theme-border-color);
    border-radius: var(--base-border-radius);
    background-color: var(--black-10a);
  }
}

.session-sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 5px;
}

.session-main {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 10px;
  padding: 10px;
}

.session-header-controls {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--theme-border-color);
}

.session-footer {
  display: flex;
  gap: 10px;
  margin-top: 5px;
}

.empty-session-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  opacity: 0.6;
  border: 1px dashed var(--theme-border-color);
  border-radius: var(--base-border-radius);
}

.spacer {
  flex: 1;
}
</style>
