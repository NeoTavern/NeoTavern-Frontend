<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Button } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import type { TextToSpeechService } from './tts-service';
import type { TextToSpeechSettings, TtsPlaybackState } from './types';

const props = defineProps<{
  api: ExtensionAPI<TextToSpeechSettings>;
  service: TextToSpeechService;
  index: number;
  onToggle: (messageIndex: number) => void;
}>();

const state = ref<TtsPlaybackState>(props.service.getPlaybackState());
const unsubscribe = props.service.subscribe((next) => {
  state.value = next;
});
onUnmounted(unsubscribe);

const isActive = computed(() => state.value.messageIndex === props.index && state.value.status !== 'idle');
const isRequesting = computed(() => isActive.value && state.value.status === 'requesting');
const title = computed(() =>
  isActive.value
    ? props.api.i18n.t('extensionsBuiltin.textToSpeech.stopPlayback')
    : props.api.i18n.t('extensionsBuiltin.textToSpeech.speakMessage'),
);
const icon = computed(() =>
  isRequesting.value ? 'fa-spinner fa-spin' : isActive.value ? 'fa-volume-xmark' : 'fa-volume-high',
);
</script>

<template>
  <Button
    variant="ghost"
    :icon="icon"
    :title="title"
    :active="isActive"
    :aria-pressed="isActive"
    @click.stop="onToggle(index)"
  />
</template>
