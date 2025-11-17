<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useExtensionStore } from '../../stores/extension.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useResizable } from '../../composables/useResizable';

const { t } = useStrictI18n();
const extensionStore = useExtensionStore();

const browserPane = ref<HTMLElement | null>(null);
const dividerEl = ref<HTMLElement | null>(null);
const isBrowserCollapsed = ref(false); // TODO: load from account storage

useResizable(browserPane, dividerEl, { storageKey: 'extensions_browser_width', initialWidth: 250 });

const notifyOnUpdates = ref(false); // TODO: Connect this to settings

// @ts-ignore
function manageExtensions() {
  // TODO: Open manage extensions popup
  alert(t('extensions.managePopupNotImplemented'));
}

// @ts-ignore
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
  <div class="extensions-panel" :class="{ 'is-collapsed': isBrowserCollapsed }">
    <!-- Left Pane: Extension Browser -->
    <div ref="browserPane" class="extensions-panel__browser">
      <div class="extensions-panel__browser-header">
        <div style="display: flex; gap: 5px">
          <div class="menu-button" :title="t('extensions.manage')">
            <i class="fa-solid fa-cubes"></i>
          </div>
          <div class="menu-button" :title="t('extensions.install')">
            <i class="fa-solid fa-cloud-arrow-down"></i>
          </div>
          <label class="checkbox-label" style="margin-left: auto; font-size: 0.9em; cursor: pointer">
            <input type="checkbox" v-model="notifyOnUpdates" />
            <span>{{ t('extensions.notifyUpdates') }}</span>
          </label>
        </div>
        <input class="text-pole" type="search" :placeholder="t('common.search')" v-model="extensionStore.searchTerm" />
      </div>

      <div class="extensions-panel__list">
        <div
          v-for="extension in extensionStore.filteredExtensions"
          :key="extension.name"
          class="extension-item"
          :class="{ 'is-active': extensionStore.selectedExtensionName === extension.name }"
          @click="extensionStore.selectExtension(extension.name)"
        >
          <i class="extension-item__icon fa-solid fa-puzzle-piece"></i>
          <div class="extension-item__content">
            <div class="extension-item__name">{{ extension.manifest.display_name || extension.name }}</div>
            <div v-if="extension.manifest.author" class="extension-item__author">
              {{ t('common.by') }} {{ extension.manifest.author }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Divider -->
    <div ref="dividerEl" class="extensions-panel__divider">
      <div class="extensions-panel__collapse-toggle" @click="isBrowserCollapsed = !isBrowserCollapsed">
        <i class="fa-solid" :class="isBrowserCollapsed ? 'fa-angles-right' : 'fa-angles-left'"></i>
      </div>
    </div>

    <!-- Right Pane: Editor -->
    <div class="extensions-panel__editor">
      <div v-if="!extensionStore.selectedExtension" class="extensions-panel__placeholder">
        <div class="placeholder-icon fa-solid fa-puzzle-piece"></div>
        <h2 class="placeholder-title">{{ t('extensions.placeholder.title') }}</h2>
        <p>{{ t('extensions.placeholder.text') }}</p>
      </div>

      <template v-for="extension in Object.values(extensionStore.extensions)" :key="extension.name">
        <div v-show="extensionStore.selectedExtensionName === extension.name">
          <div class="extension-content">
            <div class="extension-content__header">
              <h3>
                <span>{{ extension.manifest.display_name || extension.name }}</span>
                <span v-if="extension.manifest.version" class="version">v{{ extension.manifest.version }}</span>
              </h3>
            </div>
            <p v-if="extension.manifest.description" class="extension-content__description">
              {{ extension.manifest.description }}
            </p>

            <!-- This is the container where the extension will mount its UI -->
            <div :id="extension.containerId"></div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
