<script setup lang="ts">
import { useStrictI18n } from '../../composables/useStrictI18n';

const { t } = useStrictI18n();
</script>

<template>
  <div class="formatting-drawer">
    <div class="formatting-drawer-header">
      <h3>{{ t('formatting.title') }}</h3>
    </div>
    <small class="formatting-drawer-description">{{ t('formatting.description') }}</small>

    <div class="formatting-drawer-content">
      <!-- Placeholder for future formatting options -->
      <p>Formatting options will be available here in a future update.</p>
    </div>
  </div>
</template>
