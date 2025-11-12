<script setup lang="ts">
// Chat logic will be added here
</script>

<template>
  <div class="chat-interface">
    <div class="chat-interface__messages"><!-- Chat messages will be rendered here --></div>
    <div class="chat-interface__form-container">
      <form class="chat-form">
        <div class="chat-form__inner">
          <div class="chat-form__actions-left">
            <button type="button" class="chat-form__button fa-solid fa-bars" title="Options"></button>
            <button type="button" class="chat-form__button fa-solid fa-magic-wand-sparkles" title="Extensions"></button>
          </div>
          <textarea id="chat-input" placeholder="Type a message, or /? for help" autocomplete="off"></textarea>
          <div class="chat-form__actions-right">
            <button
              type="button"
              class="chat-form__button fa-fw fa-solid fa-arrow-right"
              title="Continue the last message"
            ></button>
            <button type="button" class="chat-form__button fa-solid fa-paper-plane" title="Send a message"></button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
