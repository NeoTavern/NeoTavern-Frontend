<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { RunOverlayRecord } from './editor-store';

defineProps<{ record?: RunOverlayRecord }>();
const { t } = useI18n();
</script>

<template>
  <div v-if="record" class="custom-agent-flow__run" :class="`is-${record.status.toLowerCase()}`">
    <strong>{{ t(`extensionsBuiltin.customAgents.runStatus.${record.status.toLowerCase()}`) }}</strong>
    <details v-if="record.invocations.length">
      <summary>{{ t('extensionsBuiltin.customAgents.editor.runDetails') }}</summary>
      <section
        v-for="invocation in record.invocations"
        :key="invocation.scopeInvocationId"
        class="custom-agent-flow__run-invocation"
        :data-scope-invocation-id="invocation.scopeInvocationId"
      >
        <strong>{{ invocation.scopeInvocationId }}</strong>
        <span>{{ t(`extensionsBuiltin.customAgents.runStatus.${invocation.status.toLowerCase()}`) }}</span>
        <pre v-if="invocation.error !== undefined || invocation.output !== undefined">{{
          invocation.error ?? JSON.stringify(invocation.output, null, 2)
        }}</pre>
      </section>
    </details>
  </div>
</template>
