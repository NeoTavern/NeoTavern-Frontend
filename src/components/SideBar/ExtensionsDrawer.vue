<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useExtensionStore } from '../../stores/extension.store';
import { useStrictI18n } from '../../composables/useStrictI18n';

const { t } = useStrictI18n();
const extensionStore = useExtensionStore();
const notifyOnUpdates = ref(false); // TODO: connect to settings store

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
  <div class="extensions-drawer">
    <div class="extensions-drawer__wrapper">
      <div class="extensions-drawer__header">
        <h3>{{ t('extensions.title') }}</h3>
        <label class="extensions-drawer__checkbox-label">
          <input type="checkbox" v-model="notifyOnUpdates" />
          <span>{{ t('extensions.notifyUpdates') }}</span>
        </label>
        <div @click="manageExtensions" class="menu-button">
          <i class="fa-solid fa-cubes"></i>
          <span>&nbsp;{{ t('extensions.manage') }}</span>
        </div>
        <div @click="installExtension" class="menu-button">
          <i class="fa-solid fa-cloud-arrow-down"></i>
          <span>&nbsp;{{ t('extensions.install') }}</span>
        </div>
      </div>
      <div class="extensions-drawer__content">
        <div id="extensions_settings" class="extensions-drawer__column">
          <div id="assets_container" class="extension_container"></div>
          <div id="typing_indicator_container" class="extension_container"></div>
          <div id="expressions_container" class="extension_container"></div>
          <div id="sd_container" class="extension_container"></div>
          <div id="tts_container" class="extension_container"></div>
          <div id="rvc_container" class="extension_container"></div>
          <div id="stt_container" class="extension_container"></div>
          <div id="audio_container" class="extension_container"></div>
          <div id="silence_container" class="extension_container"></div>
          <div id="objective_container" class="extension_container"></div>
          <div id="blip_container" class="extension_container"></div>
          <div id="live2d_container" class="extension_container"></div>
          <div id="vrm_container" class="extension_container"></div>
          <div id="timelines_container" class="extension_container"></div>
          <div id="webllm_container" class="extension_container"></div>
          <div id="rss_container" class="extension_container"></div>
        </div>
        <div id="extensions_settings2" class="extensions-drawer__column">
          <div id="websearch_container" class="extension_container"></div>
          <div id="emulatorjs_container" class="extension_container"></div>
          <div id="qr_container" class="extension_container"></div>
          <div id="translation_container" class="extension_container"></div>
          <div id="caption_container" class="extension_container"></div>
          <div id="idle_container" class="extension_container"></div>
          <div id="summarize_container" class="extension_container"></div>
          <div id="hypebot_container" class="extension_container"></div>
          <div id="regex_container" class="extension_container"></div>
          <div id="vectors_container" class="extension_container"></div>
          <div id="randomizer_container" class="extension_container"></div>
          <div id="chromadb_container" class="extension_container"></div>
          <div id="message_limit_container" class="extension_container"></div>
          <div id="injects_container" class="extension_container"></div>
          <div id="accuweather_container" class="extension_container"></div>
          <div id="dice_container" class="extension_container"></div>
        </div>
      </div>
    </div>
  </div>
</template>
