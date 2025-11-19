<script setup lang="ts">
import { useStrictI18n } from '../../composables/useStrictI18n';

const { t } = useStrictI18n();
</script>

<template>
  <div class="recent-chats">
    <div class="recent-chats-header">
      <h3>{{ t('navbar.chatManagement') }}</h3>
    </div>
    <div class="recent-chats-content">
      <div class="empty-state">
        <i class="fa-solid fa-comments"></i>
        <p>No recent chats</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.recent-chats {
  height: 100%;
  display: flex;
  flex-direction: column;

  &-header {
    padding: 15px;
    border-bottom: 1px solid var(--theme-border-color);

    h3 {
      margin: 0;
      font-size: 1.1em;
      opacity: 0.8;
    }
  }

  &-content {
    flex-grow: 1;
    overflow-y: auto;
    padding: 10px;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  opacity: 0.4;
  gap: 10px;

  i {
    font-size: 2em;
  }

  p {
    margin: 0;
  }
}
</style>
