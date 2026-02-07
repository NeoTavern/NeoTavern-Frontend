<script setup lang="ts">
import { Button } from '../../../../components/UI';
import type { ExtensionAPI } from '../../../../types';
import type { RewriteSettings } from '../types';
import RewriteView from './RewriteView.vue';

const props = defineProps<{
  originalText: string;
  oneShotGeneratedText: string;
  isGenerating: boolean;
  ignoreInput: boolean;
  api: ExtensionAPI<RewriteSettings>;
}>();

const emit = defineEmits<{
  generate: [];
  abort: [];
  cancel: [];
  apply: [text: string];
  copyOutput: [];
  continue: [];
}>();

const t = props.api.i18n.t;
</script>

<template>
  <div class="view-container">
    <RewriteView
      :original-text="originalText"
      :generated-text="oneShotGeneratedText"
      :is-generating="isGenerating"
      :ignore-input="ignoreInput"
      @copy-output="emit('copyOutput')"
    />

    <div class="actions-row">
      <Button v-if="!isGenerating" @click="emit('generate')">
        {{ t('extensionsBuiltin.rewrite.popup.generate') }}
      </Button>
      <Button v-else variant="danger" @click="emit('abort')">
        {{ t('extensionsBuiltin.rewrite.popup.abort') }}
      </Button>
      <div class="spacer"></div>
      <Button variant="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button variant="default" :disabled="!oneShotGeneratedText || isGenerating" @click="emit('continue')">
        {{ t('extensionsBuiltin.rewrite.popup.continue') }}
      </Button>
      <Button
        variant="confirm"
        :disabled="!oneShotGeneratedText || isGenerating"
        @click="emit('apply', oneShotGeneratedText)"
      >
        {{ t('extensionsBuiltin.rewrite.popup.apply') }}
      </Button>
    </div>
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
}

.actions-row {
  display: flex;
  gap: 10px;
  margin-top: auto;
}

.spacer {
  flex: 1;
}
</style>
