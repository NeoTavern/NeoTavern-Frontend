<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useChatUiStore, type QuickActionsLayout } from '../../stores/chat-ui.store';
import { useComponentRegistryStore } from '../../stores/component-registry.store';
import { Button, Checkbox } from '../UI';

const { t } = useStrictI18n();
const componentRegistryStore = useComponentRegistryStore();
const chatUiStore = useChatUiStore();

const isExpanded = ref(false);
const isConfigVisible = ref(false);

const configButtonRef = ref<HTMLElement | null>(null);
const configMenuRef = ref<HTMLElement | null>(null);

const { floatingStyles: configMenuStyles } = useFloating(configButtonRef, configMenuRef, {
  placement: 'top-start',
  open: isConfigVisible,
  whileElementsMounted: autoUpdate,
  middleware: [offset(8), flip(), shift({ padding: 10 })],
});

const allRegisteredGroups = computed(() => Array.from(componentRegistryStore.chatQuickActionsRegistry.values()));

const actionGroups = computed(() => {
  return allRegisteredGroups.value
    .filter(
      (group) => (group.visible ?? true) && group.actions.length > 0 && !chatUiStore.isQuickActionDisabled(group.id),
    )
    .map((group) => ({
      ...group,
      actions: group.actions.filter(
        (action) => (action.visible ?? true) && !chatUiStore.isQuickActionDisabled(action.id),
      ),
    }))
    .filter((group) => group.actions.length > 0);
});

const layoutClass = computed(() => (chatUiStore.quickActionsLayout === 'column' ? 'is-layout-column' : ''));

function toggleExpanded() {
  if (actionGroups.value.length === 0) {
    isExpanded.value = false;
    return;
  }
  isExpanded.value = !isExpanded.value;
}

function toggleConfig() {
  isConfigVisible.value = !isConfigVisible.value;
}

function handleLayoutChange(layout: QuickActionsLayout) {
  chatUiStore.setQuickActionsLayout(layout);
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;
  const isInsideConfigMenu = configMenuRef.value?.contains(target);
  const isInsideConfigButton = configButtonRef.value?.contains(target);

  if (!isInsideConfigMenu && !isInsideConfigButton) {
    isConfigVisible.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div class="chat-quick-actions" :class="{ 'is-expanded': isExpanded }">
    <div class="chat-quick-actions-header">
      <div
        class="chat-quick-actions-header-main"
        role="button"
        tabindex="0"
        :aria-expanded="isExpanded"
        aria-controls="quick-actions-content"
        @click="toggleExpanded"
        @keydown.enter.prevent="toggleExpanded"
        @keydown.space.prevent="toggleExpanded"
      >
        <i class="icon fa-solid fa-chevron-right"></i>
        <span v-if="!isExpanded">{{ t('chat.quickActions.title') }}</span>
      </div>
      <div
        ref="configButtonRef"
        class="chat-quick-actions-header-config-btn"
        role="button"
        tabindex="0"
        :aria-label="t('chat.quickActions.configure')"
        :aria-expanded="isConfigVisible"
        aria-haspopup="dialog"
        @click.stop="toggleConfig"
        @keydown.enter.prevent="toggleConfig"
        @keydown.space.prevent="toggleConfig"
      >
        <i class="fa-solid fa-cog"></i>
      </div>
    </div>

    <div id="quick-actions-content" class="chat-quick-actions-content-wrapper" :class="{ 'is-expanded': isExpanded }">
      <div>
        <div class="chat-quick-actions-content" :class="layoutClass">
          <div v-for="group in actionGroups" :key="group.id" class="quick-action-group">
            <span v-if="group.label" class="group-label">{{ group.label }}</span>
            <div class="group-actions">
              <Button
                v-for="action in group.actions"
                :key="action.id"
                class="quick-action-btn"
                variant="ghost"
                :icon="action.icon"
                :disabled="action.disabled"
                :label="action.label"
                :title="action.title ?? action.label"
                @click="action.onClick"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Config Popover -->
    <div
      v-show="isConfigVisible"
      ref="configMenuRef"
      class="chat-quick-actions-config"
      role="dialog"
      :aria-label="t('chat.quickActions.configure')"
      :style="configMenuStyles"
    >
      <div class="chat-quick-actions-config-section">
        <div class="chat-quick-actions-config-title">{{ t('chat.quickActions.layout') }}</div>
        <div class="chat-quick-actions-config-layout-options">
          <Button :active="chatUiStore.quickActionsLayout === 'row'" @click="handleLayoutChange('row')">
            {{ t('chat.quickActions.layoutRow') }}
          </Button>
          <Button :active="chatUiStore.quickActionsLayout === 'column'" @click="handleLayoutChange('column')">
            {{ t('chat.quickActions.layoutColumn') }}
          </Button>
        </div>
      </div>

      <div class="chat-quick-actions-config-section">
        <div class="chat-quick-actions-config-title">{{ t('chat.quickActions.enabledActions') }}</div>
        <div class="chat-quick-actions-config-actions-list">
          <div v-for="group in allRegisteredGroups" :key="group.id" class="config-group">
            <Checkbox
              :model-value="!chatUiStore.isQuickActionDisabled(group.id)"
              :label="group.label || group.id"
              class="config-group-header"
              @update:model-value="chatUiStore.toggleQuickAction(group.id)"
            />
            <div v-for="action in group.actions" :key="action.id" class="config-action">
              <Checkbox
                :model-value="!chatUiStore.isQuickActionDisabled(action.id)"
                :label="action.label ?? action.title ?? action.id"
                :disabled="chatUiStore.isQuickActionDisabled(group.id)"
                @update:model-value="chatUiStore.toggleQuickAction(action.id)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
