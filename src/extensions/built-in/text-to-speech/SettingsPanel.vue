<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Button, FormItem, Input, RangeControl, Select, Textarea, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import {
  DEFAULT_TTS_SETTINGS,
  mergeTtsSettings,
  type TextToSpeechExtensionService,
  type TextToSpeechSettings,
  type TtsProviderId,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<TextToSpeechSettings>;
}>();

const t = props.api.i18n.t;

const settings = ref<TextToSpeechSettings>(mergeTtsSettings(props.api.settings.get()));
const voices = ref<{ label: string; value: string }[]>([]);
const isRefreshing = ref(false);
const isTesting = ref(false);

const service = computed(() => props.api.extensions.getService<TextToSpeechExtensionService>('core.text-to-speech'));

const providerOptions = computed<Array<{ label: string; value: TtsProviderId }>>(() => [
  { label: t('extensionsBuiltin.textToSpeech.providers.kokoroFastApi'), value: 'kokoro-fastapi' },
  { label: t('extensionsBuiltin.textToSpeech.providers.system'), value: 'system' },
  { label: t('extensionsBuiltin.textToSpeech.providers.openai'), value: 'openai' },
  { label: t('extensionsBuiltin.textToSpeech.providers.elevenlabs'), value: 'elevenlabs' },
  { label: t('extensionsBuiltin.textToSpeech.providers.openaiCompatible'), value: 'openai-compatible' },
]);

const openAiVoiceOptions = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].map(
  (voice) => ({ label: voice, value: voice }),
);

const responseFormatOptions = ['mp3', 'wav', 'opus', 'flac', 'aac', 'pcm'].map((format) => ({
  label: format,
  value: format,
}));

const activeVoiceModel = computed({
  get() {
    switch (settings.value.provider) {
      case 'system':
        return settings.value.system.voice;
      case 'openai':
        return settings.value.openai.voice;
      case 'elevenlabs':
        return settings.value.elevenlabs.voiceId;
      case 'kokoro-fastapi':
        return settings.value.kokoro.voice;
      case 'openai-compatible':
        return settings.value.openaiCompatible.voice;
    }
    return '';
  },
  set(value: string) {
    switch (settings.value.provider) {
      case 'system':
        settings.value.system.voice = value;
        break;
      case 'openai':
        settings.value.openai.voice = value;
        break;
      case 'elevenlabs':
        settings.value.elevenlabs.voiceId = value;
        break;
      case 'kokoro-fastapi':
        settings.value.kokoro.voice = value;
        break;
      case 'openai-compatible':
        settings.value.openaiCompatible.voice = value;
        break;
    }
  },
});

const voiceOptions = computed(() => {
  if (settings.value.provider === 'openai') return openAiVoiceOptions;

  if (settings.value.provider === 'kokoro-fastapi' && voices.value.length === 0) {
    return settings.value.kokoro.voices
      .split('\n')
      .map((voice) => voice.trim())
      .filter(Boolean)
      .map((voice) => ({ label: voice, value: voice }));
  }

  return voices.value;
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);

watch(
  () => settings.value.provider,
  () => {
    refreshVoices(false);
  },
);

onMounted(() => {
  props.api.settings.set(undefined, settings.value);
  props.api.settings.save();
  refreshVoices(false);
});

async function refreshVoices(showToast = true) {
  const tts = service.value;
  if (!tts) return;

  isRefreshing.value = true;
  try {
    voices.value = (await tts.refreshVoices()).map((voice) => ({
      label: voice.lang ? `${voice.name} (${voice.lang})` : voice.name,
      value: voice.id,
    }));
    if (showToast) props.api.ui.showToast(t('extensionsBuiltin.textToSpeech.voicesRefreshed'), 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (showToast) props.api.ui.showToast(`${t('extensionsBuiltin.textToSpeech.refreshFailed')}: ${message}`, 'error');
  } finally {
    isRefreshing.value = false;
  }
}

async function testVoice() {
  const tts = service.value;
  if (!tts) return;

  isTesting.value = true;
  try {
    await tts.speakText(t('extensionsBuiltin.textToSpeech.testPhrase'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    props.api.ui.showToast(`${t('extensionsBuiltin.textToSpeech.playbackFailed')}: ${message}`, 'error');
  } finally {
    isTesting.value = false;
  }
}

function resetSettings() {
  settings.value = mergeTtsSettings(DEFAULT_TTS_SETTINGS);
}
</script>

<template>
  <div class="tts-settings">
    <div class="tts-settings__toolbar">
      <Button icon="fa-rotate-left" variant="ghost" :title="t('common.reset')" @click="resetSettings" />
      <Button
        icon="fa-volume-high"
        :loading="isTesting"
        :title="t('extensionsBuiltin.textToSpeech.testVoice')"
        @click="testVoice"
      />
    </div>

    <FormItem :label="t('extensionsBuiltin.textToSpeech.enabled')">
      <Toggle v-model="settings.enabled" :label="t('extensionsBuiltin.textToSpeech.enabled')" />
    </FormItem>

    <FormItem :label="t('extensionsBuiltin.textToSpeech.provider')">
      <Select v-model="settings.provider" :options="providerOptions" />
    </FormItem>

    <div class="tts-settings__grid">
      <FormItem
        :label="t('extensionsBuiltin.textToSpeech.autoPlayAssistant')"
        :description="t('extensionsBuiltin.textToSpeech.autoPlayAssistantHint')"
      >
        <Toggle v-model="settings.autoPlayAssistant" :label="t('extensionsBuiltin.textToSpeech.autoPlayAssistant')" />
      </FormItem>

      <FormItem :label="t('extensionsBuiltin.textToSpeech.interruptPlayback')">
        <Toggle v-model="settings.interruptPlayback" :label="t('extensionsBuiltin.textToSpeech.interruptPlayback')" />
      </FormItem>

      <FormItem
        :label="t('extensionsBuiltin.textToSpeech.streamingPlayback')"
        :description="t('extensionsBuiltin.textToSpeech.streamingPlaybackHint')"
      >
        <Toggle v-model="settings.streamingPlayback" :label="t('extensionsBuiltin.textToSpeech.streamingPlayback')" />
      </FormItem>

      <FormItem :label="t('extensionsBuiltin.textToSpeech.narrateUserMessages')">
        <Toggle
          v-model="settings.narrateUserMessages"
          :label="t('extensionsBuiltin.textToSpeech.narrateUserMessages')"
        />
      </FormItem>

      <FormItem :label="t('extensionsBuiltin.textToSpeech.narrateSystemMessages')">
        <Toggle
          v-model="settings.narrateSystemMessages"
          :label="t('extensionsBuiltin.textToSpeech.narrateSystemMessages')"
        />
      </FormItem>

      <FormItem :label="t('extensionsBuiltin.textToSpeech.stripMarkdown')">
        <Toggle v-model="settings.stripMarkdown" :label="t('extensionsBuiltin.textToSpeech.stripMarkdown')" />
      </FormItem>
    </div>

    <template v-if="settings.provider === 'kokoro-fastapi'">
      <FormItem
        :label="t('extensionsBuiltin.textToSpeech.baseUrl')"
        :description="t('extensionsBuiltin.textToSpeech.kokoroBaseUrlHint')"
      >
        <Input v-model="settings.kokoro.baseUrl" />
      </FormItem>
      <div class="tts-settings__grid">
        <FormItem :label="t('extensionsBuiltin.textToSpeech.model')">
          <Input v-model="settings.kokoro.model" />
        </FormItem>
        <FormItem :label="t('extensionsBuiltin.textToSpeech.responseFormat')">
          <Select v-model="settings.kokoro.responseFormat" :options="responseFormatOptions" />
        </FormItem>
      </div>
      <RangeControl
        v-model="settings.kokoro.speed"
        :label="t('extensionsBuiltin.textToSpeech.speed')"
        :min="0.25"
        :max="4"
        :step="0.05"
      />
      <FormItem
        :label="t('extensionsBuiltin.textToSpeech.kokoroVoices')"
        :description="t('extensionsBuiltin.textToSpeech.kokoroVoicesHint')"
      >
        <Textarea v-model="settings.kokoro.voices" :rows="6" identifier="extension.tts.kokoro-voices" />
      </FormItem>
    </template>

    <template v-if="settings.provider === 'openai-compatible'">
      <FormItem :label="t('extensionsBuiltin.textToSpeech.baseUrl')">
        <Input v-model="settings.openaiCompatible.baseUrl" />
      </FormItem>
      <div class="tts-settings__grid">
        <FormItem :label="t('extensionsBuiltin.textToSpeech.model')">
          <Input v-model="settings.openaiCompatible.model" />
        </FormItem>
        <FormItem :label="t('extensionsBuiltin.textToSpeech.responseFormat')">
          <Select v-model="settings.openaiCompatible.responseFormat" :options="responseFormatOptions" />
        </FormItem>
      </div>
      <FormItem
        :label="t('extensionsBuiltin.textToSpeech.apiKey')"
        :description="t('extensionsBuiltin.textToSpeech.apiKeyHint')"
      >
        <Input v-model="settings.openaiCompatible.apiKey" type="password" />
      </FormItem>
      <RangeControl
        v-model="settings.openaiCompatible.speed"
        :label="t('extensionsBuiltin.textToSpeech.speed')"
        :min="0.25"
        :max="4"
        :step="0.05"
      />
    </template>

    <template v-if="settings.provider === 'openai'">
      <FormItem :label="t('extensionsBuiltin.textToSpeech.model')">
        <Input v-model="settings.openai.model" />
      </FormItem>
      <div class="tts-settings__grid">
        <FormItem :label="t('extensionsBuiltin.textToSpeech.responseFormat')">
          <Select v-model="settings.openai.responseFormat" :options="responseFormatOptions" />
        </FormItem>
        <RangeControl
          v-model="settings.openai.speed"
          :label="t('extensionsBuiltin.textToSpeech.speed')"
          :min="0.25"
          :max="4"
          :step="0.05"
        />
      </div>
    </template>

    <template v-if="settings.provider === 'elevenlabs'">
      <div class="tts-settings__grid">
        <FormItem :label="t('extensionsBuiltin.textToSpeech.model')">
          <Input v-model="settings.elevenlabs.model" />
        </FormItem>
        <RangeControl
          v-model="settings.elevenlabs.stability"
          :label="t('extensionsBuiltin.textToSpeech.stability')"
          :min="0"
          :max="1"
          :step="0.01"
        />
        <RangeControl
          v-model="settings.elevenlabs.similarityBoost"
          :label="t('extensionsBuiltin.textToSpeech.similarityBoost')"
          :min="0"
          :max="1"
          :step="0.01"
        />
      </div>
    </template>

    <template v-if="settings.provider === 'system'">
      <div class="tts-settings__grid">
        <RangeControl
          v-model="settings.system.rate"
          :label="t('extensionsBuiltin.textToSpeech.rate')"
          :min="0.25"
          :max="4"
          :step="0.05"
        />
        <RangeControl
          v-model="settings.system.pitch"
          :label="t('extensionsBuiltin.textToSpeech.pitch')"
          :min="0"
          :max="2"
          :step="0.05"
        />
      </div>
    </template>

    <div class="tts-settings__voice-row">
      <FormItem
        :label="t('extensionsBuiltin.textToSpeech.voice')"
        :description="t('extensionsBuiltin.textToSpeech.voiceHint')"
      >
        <Select v-model="activeVoiceModel" :options="voiceOptions" searchable />
      </FormItem>
      <Button
        icon="fa-arrows-rotate"
        :loading="isRefreshing"
        :title="t('extensionsBuiltin.textToSpeech.refreshVoices')"
        @click="refreshVoices(true)"
      />
    </div>

    <FormItem
      :label="t('extensionsBuiltin.textToSpeech.characterVoices')"
      :description="t('extensionsBuiltin.textToSpeech.characterVoicesHint')"
    >
      <Textarea v-model="settings.characterVoices" :rows="6" identifier="extension.tts.character-voices" />
    </FormItem>
  </div>
</template>

<style scoped>
.tts-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}

.tts-settings__toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.tts-settings__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.tts-settings__voice-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
}
</style>
