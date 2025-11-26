import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as secretApi from '../api/secrets';
import { toast } from '../composables/useToast';
import type { SecretMap } from '../types/secrets';

export const useSecretStore = defineStore('secret', () => {
  const secrets = ref<SecretMap>({});
  const pendingSecrets = ref<Record<string, string>>({});
  const initialized = ref(false);

  async function fetchSecrets() {
    try {
      secrets.value = await secretApi.fetchSecrets();
      initialized.value = true;
    } catch (error) {
      console.error('Failed to fetch secrets:', error);
      toast.error('Failed to load API keys');
    }
  }

  async function createSecret(key: string, value: string, label: string): Promise<string | null> {
    try {
      const response = await secretApi.createSecret({ key, value, label });
      await fetchSecrets();
      toast.success('API Key added');
      return response.id;
    } catch (error) {
      console.error(error);
      toast.error('Failed to add API Key');
      return null;
    }
  }

  async function deleteSecret(key: string, id: string) {
    try {
      await secretApi.deleteSecret({ key, id });
      await fetchSecrets();
      toast.success('API Key deleted');
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete API Key');
    }
  }

  async function renameSecret(key: string, id: string, label: string) {
    try {
      await secretApi.renameSecret({ key, id, label });
      await fetchSecrets();
      toast.success('API Key renamed');
    } catch (error) {
      console.error(error);
      toast.error('Failed to rename API Key');
    }
  }

  async function rotateSecret(key: string, id: string) {
    try {
      await secretApi.rotateSecret({ key, id });
      await fetchSecrets();
      toast.success('API Key activated');
    } catch (error) {
      console.error(error);
      toast.error('Failed to activate API Key');
    }
  }

  function getActiveSecret(key: string) {
    return secrets.value[key]?.find((s) => s.active);
  }

  return {
    secrets,
    pendingSecrets,
    initialized,
    fetchSecrets,
    createSecret,
    deleteSecret,
    renameSecret,
    rotateSecret,
    getActiveSecret,
  };
});
