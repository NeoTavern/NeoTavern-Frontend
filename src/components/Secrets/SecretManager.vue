<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { FRIENDLY_SECRET_NAMES } from '../../constants';
import { useSecretStore } from '../../stores/secret.store';
import { Button, Icon, Input } from '../UI';

const props = defineProps<{
  secretKey: string;
}>();

const { t } = useStrictI18n();
const secretStore = useSecretStore();

const newKeyLabel = ref('');
const newKeyValue = ref('');
const showAddForm = ref(false);

const friendlyName = computed(() => FRIENDLY_SECRET_NAMES[props.secretKey] || props.secretKey);
const secrets = computed(() => secretStore.secrets[props.secretKey] || []);
const sortedSecrets = computed(() => {
  return [...secrets.value].sort((a, b) => {
    // Active first
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    // Then alphabetical
    return a.label.localeCompare(b.label);
  });
});

async function handleAdd() {
  if (!newKeyValue.value) return;
  const label = newKeyLabel.value.trim() || new Date().toLocaleString();
  await secretStore.createSecret(props.secretKey, newKeyValue.value, label);
  newKeyLabel.value = '';
  newKeyValue.value = '';
  showAddForm.value = false;
}

function handleRotate(id: string) {
  secretStore.rotateSecret(props.secretKey, id);
}

function handleDelete(id: string) {
  secretStore.deleteSecret(props.secretKey, id);
}

const editingId = ref<string | null>(null);
const editLabelValue = ref('');

function startEdit(secret: { id: string; label: string }) {
  editingId.value = secret.id;
  editLabelValue.value = secret.label;
}

async function saveEdit(id: string) {
  if (editLabelValue.value.trim()) {
    await secretStore.renameSecret(props.secretKey, id, editLabelValue.value);
  }
  editingId.value = null;
}

function cancelEdit() {
  editingId.value = null;
}
</script>

<template>
  <div class="secret-manager">
    <div class="secret-manager-header">
      <h3>{{ t('secrets.manageKeysFor') }} {{ friendlyName }}</h3>
    </div>

    <div class="secret-list">
      <div v-if="secrets.length === 0" class="empty-list">
        {{ t('secrets.noKeysFound') }}
      </div>

      <div v-for="secret in sortedSecrets" :key="secret.id" class="secret-item" :class="{ active: secret.active }">
        <div class="secret-info">
          <div v-if="editingId === secret.id" class="edit-row">
            <Input v-model="editLabelValue" class="edit-input" />
            <Button icon="fa-check" variant="ghost" @click="saveEdit(secret.id)" />
            <Button icon="fa-xmark" variant="ghost" @click="cancelEdit" />
          </div>
          <div v-else class="view-row">
            <span class="secret-label" :title="secret.value">{{ secret.label }}</span>
            <span class="secret-mask">{{ secret.value }}</span>
          </div>
        </div>

        <div class="secret-actions">
          <Button
            v-if="!secret.active"
            icon="fa-power-off"
            :title="t('common.activate')"
            variant="ghost"
            @click="handleRotate(secret.id)"
          />
          <span v-else class="active-badge"><Icon icon="fa-check" /></span>

          <Button icon="fa-pencil" variant="ghost" :title="t('common.rename')" @click="startEdit(secret)" />
          <Button icon="fa-trash" variant="danger" :title="t('common.delete')" @click="handleDelete(secret.id)" />
        </div>
      </div>
    </div>

    <div class="add-secret-section">
      <Button v-if="!showAddForm" icon="fa-plus" @click="showAddForm = true">
        {{ t('secrets.addNewKey') }}
      </Button>

      <div v-else class="add-form">
        <h4>{{ t('secrets.addNewKey') }}</h4>
        <Input v-model="newKeyLabel" :placeholder="t('secrets.labelPlaceholder')" />
        <Input v-model="newKeyValue" type="password" :placeholder="t('secrets.keyPlaceholder')" />
        <div class="add-actions">
          <Button variant="confirm" :disabled="!newKeyValue" @click="handleAdd">{{ t('common.save') }}</Button>
          <Button variant="ghost" @click="showAddForm = false">{{ t('common.cancel') }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.secret-manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 400px;
  max-width: 600px;
}

.secret-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.secret-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-30a);

  &.active {
    border-color: var(--color-accent-green-70a);
    background-color: var(--grey-5020a);
  }
}

.secret-info {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .view-row {
    display: flex;
    flex-direction: column;
  }

  .edit-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.secret-label {
  font-weight: bold;
}

.secret-mask {
  font-family: monospace;
  font-size: 0.85em;
  opacity: 0.7;
}

.secret-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}

.active-badge {
  color: var(--color-accent-green-70a);
  padding: 0 8px;
}

.add-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-30a);
}

.add-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.empty-list {
  text-align: center;
  padding: 20px;
  opacity: 0.6;
}
</style>
