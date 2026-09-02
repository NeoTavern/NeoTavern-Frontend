<script setup lang="ts">
import { Button } from '../../../../components/UI';
import { useEditorI18n } from './editor-i18n';

defineProps<{
  canUndo: boolean;
  canRedo: boolean;
  canApply: boolean;
  canSmartLayout: boolean;
  smartLayoutTitle: string;
  smartLayoutBusy: boolean;
  canSmartLayoutAll: boolean;
  smartLayoutAllTitle: string;
  smartLayoutAllBusy: boolean;
  smartLayoutStatus?: string;
  dirty: boolean;
  nested: boolean;
}>();
const { t } = useEditorI18n();
const emit = defineEmits<{
  undo: [];
  redo: [];
  copy: [];
  paste: [];
  fit: [];
  smartLayout: [];
  smartLayoutAll: [];
  apply: [];
  reset: [];
  back: [];
}>();
</script>

<template>
  <nav class="custom-agent-flow__toolbar" :aria-label="t('extensionsBuiltin.customAgents.editor.actions')">
    <Button
      v-if="nested"
      icon="fa-arrow-left"
      :title="t('extensionsBuiltin.customAgents.editor.backToParent')"
      @click="emit('back')"
    />
    <Button icon="fa-rotate-left" :title="t('common.undo')" :disabled="!canUndo" @click="emit('undo')" />
    <Button icon="fa-rotate-right" :title="t('common.redo')" :disabled="!canRedo" @click="emit('redo')" />
    <Button icon="fa-copy" :title="t('common.copy')" @click="emit('copy')" />
    <Button icon="fa-paste" :title="t('common.paste')" @click="emit('paste')" />
    <Button icon="fa-expand" :title="t('extensionsBuiltin.customAgents.editor.fitView')" @click="emit('fit')" />
    <Button
      icon="fa-wand-magic-sparkles"
      :title="smartLayoutTitle"
      :disabled="!canSmartLayout"
      :loading="smartLayoutBusy"
      @click="emit('smartLayout')"
    />
    <Button
      icon="fa-diagram-project"
      :title="smartLayoutAllTitle"
      :disabled="!canSmartLayoutAll"
      :loading="smartLayoutAllBusy"
      @click="emit('smartLayoutAll')"
    />
    <span v-if="smartLayoutStatus" role="status">{{ smartLayoutStatus }}</span>
    <span class="custom-agent-flow__toolbar-spacer" />
    <span v-if="dirty">{{ t('extensionsBuiltin.customAgents.editor.unsavedDraft') }}</span>
    <Button
      :title="t('extensionsBuiltin.customAgents.editor.discardDraft')"
      :disabled="!dirty"
      @click="emit('reset')"
      >{{ t('common.discard') }}</Button
    >
    <Button
      variant="confirm"
      :title="t('extensionsBuiltin.customAgents.editor.applyValidDraft')"
      :disabled="!canApply || !dirty"
      @click="emit('apply')"
      >{{ t('common.apply') }}</Button
    >
  </nav>
</template>
