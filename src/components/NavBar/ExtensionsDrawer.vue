<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useExtensionStore } from '../../stores/extension.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { AppIconButton, AppInput, AppToggle } from '../UI';
import SplitPane from '../Common/SplitPane.vue';
import EmptyState from '../Common/EmptyState.vue';

const { t } = useStrictI18n();
const extensionStore = useExtensionStore();

const isBrowserCollapsed = ref(false); // TODO: load from account storage
const notifyOnUpdates = ref(false); // TODO: Connect this to settings

function manageExtensions() {
  // TODO: Open manage extensions popup
  alert(t('extensions.managePopupNotImplemented'));
}

function installExtension() {
  // TODO: Open install extension popup
  alert(t('extensions.installPopupNotImplemented'));
}

onMounted(() => {
  // Only initialize once
  if (Object.keys(extensionStore.extensions).length === 0) {
    extensionStore.initializeExtensions();
  }
});
</script>

<template>
  <SplitPane
    v-model:collapsed="isBrowserCollapsed"
    storage-key="extensionsBrowserWidth"
    :initial-width="250"
    class="extensions-panel"
  >
    <template #side>
      <div class="extensions-panel-browser-header">
        <div style="display: flex; gap: 5px; align-items: center">
          <AppIconButton icon="fa-cubes" :title="t('extensions.manage')" @click="manageExtensions" />
          <AppIconButton icon="fa-cloud-arrow-down" :title="t('extensions.install')" @click="installExtension" />
          <AppToggle v-model="notifyOnUpdates" :title="t('extensions.notifyUpdates')" style="margin-left: auto" />
        </div>
        <AppInput v-model="extensionStore.searchTerm" type="search" :placeholder="t('common.search')" />
      </div>

      <div class="extensions-panel-list">
        <div
          v-for="extension in extensionStore.filteredExtensions"
          :key="extension.id"
          class="extension-item"
          :class="{ 'is-active': extensionStore.selectedExtensionId === extension.id }"
          :data-extension-id="extension.id"
          @click="extensionStore.selectExtension(extension.id)"
        >
          <i class="extension-item-icon fa-solid fa-puzzle-piece"></i>
          <div class="extension-item-content">
            <div class="extension-item-name">{{ extension.manifest.display_name || extension.id }}</div>
            <div v-if="extension.manifest.author" class="extension-item-author">
              {{ t('common.by') }} {{ extension.manifest.author }}
            </div>
          </div>
          <div class="extension-item-actions" @click.stop>
            <AppToggle
              :model-value="extension.isActive"
              @update:model-value="(val) => extensionStore.toggleExtension(extension.id, val)"
            />
          </div>
        </div>
      </div>
    </template>

    <template #main>
      <div class="extensions-panel-editor">
        <EmptyState
          v-show="!extensionStore.selectedExtension"
          icon="fa-puzzle-piece"
          :title="t('extensions.placeholder.title')"
          :description="t('extensions.placeholder.text')"
        />

        <template v-for="extension in Object.values(extensionStore.extensions)" :key="extension.id">
          <div v-show="extensionStore.selectedExtensionId === extension.id">
            <div class="extension-content">
              <div class="extension-content-header">
                <h3>
                  <span>{{ extension.manifest.display_name || extension.id }}</span>
                  <span v-if="extension.manifest.version" class="version">v{{ extension.manifest.version }}</span>
                </h3>
              </div>
              <p v-if="extension.manifest.description" class="extension-content-description">
                {{ extension.manifest.description }}
              </p>

              <!-- This is the container where the extension will mount its UI -->
              <div :id="extension.containerId"></div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </SplitPane>
</template>
