<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { useAuthStore, type User } from '../../stores/auth.store';
import { SmartAvatar } from '../common';
import { Button, Input } from '../UI';

const authStore = useAuthStore();
const { t } = useStrictI18n();

const selectedUser = ref<User | null>(null);
const handleInput = ref('');
const passwordInput = ref('');
const isLoading = ref(false);

const isDiscreet = computed(() => authStore.isDiscreet);

async function selectUser(user: User) {
  if (isLoading.value) return;

  if (!user.password) {
    await performLogin(user.handle, '');
  } else {
    selectedUser.value = user;
    handleInput.value = user.handle;
    passwordInput.value = '';
  }
}

function cancelSelection() {
  if (isLoading.value) return;
  selectedUser.value = null;
  handleInput.value = '';
  passwordInput.value = '';
}

async function performLogin(handle: string, password?: string) {
  if (!handle) {
    toast.error(t('login.errors.enterUsername'));
    return;
  }

  isLoading.value = true;
  try {
    await authStore.login(handle, password);
    toast.success(t('login.messages.loggedInAs', { handle }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    toast.error(error.message || t('login.errors.loginFailed'));
    console.error(error);
    isLoading.value = false;
  }
}

async function handleFormSubmit() {
  const handle = isDiscreet.value || !selectedUser.value ? handleInput.value : selectedUser.value.handle;
  await performLogin(handle, passwordInput.value);
}
</script>

<template>
  <div class="login-view">
    <div class="login-card">
      <div class="login-header">
        <h2>{{ t('common.welcome') }}</h2>
        <p class="subtitle">
          <span v-if="isLoading">{{ t('login.authenticating') }}</span>
          <span v-else-if="selectedUser">{{ t('login.enterPassword') }}</span>
          <span v-else>{{ t('login.selectAccount') }}</span>
        </p>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="loading-container">
        <i class="fa-solid fa-circle-notch fa-spin fa-3x" aria-hidden="true"></i>
      </div>

      <!-- Content -->
      <div v-else class="login-content">
        <!-- User List Grid -->
        <div v-if="!isDiscreet && !selectedUser" class="user-grid">
          <div v-for="user in authStore.userList" :key="user.handle" class="user-item" @click="selectUser(user)">
            <div class="avatar-wrapper">
              <SmartAvatar :urls="[user.avatar || '/img/user-default.png']" :alt="user.name" />
            </div>
            <div class="user-info">
              <span class="name">{{ user.name }}</span>
              <span class="handle">@{{ user.handle }}</span>
            </div>
          </div>
        </div>

        <!-- Password / Discreet Login Form -->
        <form v-else class="login-form" @submit.prevent="handleFormSubmit">
          <Input
            v-if="isDiscreet || !selectedUser"
            v-model="handleInput"
            :label="t('login.username')"
            :placeholder="t('login.username')"
            :disabled="isLoading"
            required
          />

          <Input
            v-model="passwordInput"
            type="password"
            :label="t('login.password')"
            :placeholder="t('login.password')"
            :disabled="isLoading"
            autofocus
          />

          <div class="form-actions">
            <Button v-if="selectedUser" variant="ghost" :disabled="isLoading" @click="cancelSelection">
              {{ t('common.back') }}
            </Button>
            <Button type="submit" variant="confirm" :loading="isLoading" :disabled="isLoading">
              {{ t('common.login') }}
            </Button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
