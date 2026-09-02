<script setup lang="ts">
import { Button } from '../../../../components/UI';
import type { GraphDiagnostic } from '../graph/diagnostics';
import { useEditorI18n } from './editor-i18n';

defineProps<{ diagnostics: readonly GraphDiagnostic[] }>();
const emit = defineEmits<{ focus: [diagnostic: GraphDiagnostic] }>();
const { t } = useEditorI18n();
</script>

<template>
  <aside class="custom-agent-flow__diagnostics" aria-live="polite">
    <strong>{{ t('extensionsBuiltin.customAgents.editor.diagnosticCount', diagnostics.length) }}</strong>
    <Button
      v-for="diagnostic in diagnostics"
      type="button"
      :key="`${diagnostic.code}:${JSON.stringify(diagnostic.location)}`"
      :title="t('extensionsBuiltin.customAgents.editor.focusDiagnostic', { code: diagnostic.code })"
      @click="emit('focus', diagnostic)"
    >
      <span
        >{{ t(`extensionsBuiltin.customAgents.editor.severity.${diagnostic.severity.toLowerCase()}`) }} ·
        {{ diagnostic.code }}</span
      >
      {{ diagnostic.message }}
    </Button>
  </aside>
</template>
