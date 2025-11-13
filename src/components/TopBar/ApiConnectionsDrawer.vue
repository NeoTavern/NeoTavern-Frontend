<script setup lang="ts">
import { useApiStore } from '../../stores/api.store';
import { chat_completion_sources } from '../../types';

const apiStore = useApiStore();
</script>

<template>
  <div class="api-connections-drawer">
    <div class="api-connections-drawer__wrapper">
      <!-- TODO: Implement Connection Profiles -->
      <div class="api-connections-drawer__section">
        <h3>Connection Profile</h3>
        <p>Connection Profiles are not yet implemented.</p>
      </div>

      <hr />

      <div class="api-connections-drawer__section">
        <h3>API</h3>
        <select class="text-pole" v-model="apiStore.mainApi">
          <option value="openai">Chat Completion</option>
          <option value="textgenerationwebui" disabled>Text Completion (TODO)</option>
          <option value="novel" disabled>NovelAI (TODO)</option>
          <option value="koboldhorde" disabled>AI Horde (TODO)</option>
          <option value="kobold" disabled>KoboldAI Classic (TODO)</option>
        </select>
      </div>

      <div v-if="apiStore.mainApi === 'openai'">
        <div class="api-connections-drawer__section">
          <h4>Chat Completion Source</h4>
          <select class="text-pole" v-model="apiStore.oaiSettings.chat_completion_source">
            <optgroup>
              <option :value="chat_completion_sources.OPENAI">OpenAI</option>
              <option :value="chat_completion_sources.CLAUDE">Claude</option>
              <option :value="chat_completion_sources.OPENROUTER">OpenRouter</option>
              <!-- Add other sources as they are implemented -->
            </optgroup>
          </select>
        </div>

        <!-- OpenAI Form -->
        <form v-if="apiStore.oaiSettings.chat_completion_source === chat_completion_sources.OPENAI">
          <div class="api-connections-drawer__section">
            <h4>OpenAI API key</h4>
            <div class="u-flex u-items-center">
              <input
                type="password"
                class="text-pole u-w-full"
                autocomplete="off"
                placeholder="Enter your OpenAI API key"
                v-model="apiStore.oaiSettings.api_key_openai"
              />
              <div class="menu-button fa-solid fa-key fa-fw" title="Manage API keys"></div>
            </div>
            <div class="neutral_warning">
              For privacy reasons, your API key will be hidden after you click 'Connect'.
            </div>
          </div>
          <div class="api-connections-drawer__section">
            <h4>OpenAI Model</h4>
            <!-- This list is a static example. A real implementation would fetch it. -->
            <select class="text-pole" v-model="apiStore.oaiSettings.model_openai_select">
              <optgroup label="GPT-4o">
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
              </optgroup>
              <optgroup label="GPT-4 Turbo">
                <option value="gpt-4-turbo">gpt-4-turbo</option>
              </optgroup>
            </select>
          </div>
        </form>

        <!-- Claude Form (placeholder) -->
        <form v-if="apiStore.oaiSettings.chat_completion_source === chat_completion_sources.CLAUDE">
          <div class="api-connections-drawer__section">
            <h4>Claude API Key</h4>
            <div class="u-flex u-items-center">
              <input
                type="password"
                class="text-pole u-w-full"
                autocomplete="off"
                placeholder="Enter your Claude API key"
                v-model="apiStore.oaiSettings.api_key_claude"
              />
              <div class="menu-button fa-solid fa-key fa-fw" title="Manage API keys"></div>
            </div>
            <div class="neutral_warning">
              For privacy reasons, your API key will be hidden after you click 'Connect'.
            </div>
          </div>
          <div class="api-connections-drawer__section">
            <h4>Claude Model</h4>
            <select class="text-pole" v-model="apiStore.oaiSettings.model_claude_select">
              <option value="claude-3-5-sonnet-20240620">claude-3-5-sonnet-20240620</option>
              <option value="claude-3-opus-20240229">claude-3-opus-20240229</option>
              <option value="claude-3-haiku-20240307">claude-3-haiku-20240307</option>
            </select>
          </div>
        </form>

        <!-- TODO: Add forms for other sources -->

        <div class="api-connections-drawer__section">
          <div class="u-flex u-items-center" style="margin-top: 15px">
            <button
              @click.prevent="apiStore.connect"
              class="menu-button"
              :disabled="apiStore.isConnecting"
              :class="{ disabled: apiStore.isConnecting }"
            >
              <i v-if="apiStore.isConnecting" class="fa-solid fa-spinner fa-spin"></i>
              <span v-else>Connect</span>
            </button>
          </div>
          <div class="online_status">
            <div
              class="online_status_indicator"
              :class="{ success: apiStore.onlineStatus === 'Valid' || apiStore.onlineStatus.includes('bypassed') }"
            ></div>
            <div class="online_status_text">{{ apiStore.onlineStatus }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
