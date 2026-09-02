<script setup lang="ts">
import { Button } from '../../../../components/UI';
import type { GraphSelectedAgentContext } from '../host/runtime';
import type { CustomAgentsHostAPI } from '../host/api';

defineProps<{
  context?: GraphSelectedAgentContext;
  t: CustomAgentsHostAPI['i18n']['t'];
  busy?: boolean;
}>();
const emit = defineEmits<{ reset: [] }>();
</script>

<template>
  <fieldset class="custom-agent-panel">
    <legend>{{ t('extensionsBuiltin.customAgents.state') }}</legend>
    <template v-if="context">
      <pre>{{ JSON.stringify(context.state, null, 2) }}</pre>
      <Button type="button" variant="danger" :disabled="busy" @click="emit('reset')">
        {{ t('extensionsBuiltin.customAgents.resetBranch') }}
      </Button>
    </template>
    <p v-else>{{ t('extensionsBuiltin.customAgents.noActiveChat') }}</p>
  </fieldset>
</template>
