<script setup lang="ts">
import { ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { uuidv4 } from '../../utils/commons';
import { DraggableList } from '../common';
import { Button, Icon, Textarea } from '../UI';

const props = defineProps<{
  greetings: string[];
  firstMes: string;
}>();

const emit = defineEmits<{
  (e: 'update:greetings', value: string[]): void;
  (e: 'update:firstMes', value: string): void;
}>();

const { t } = useStrictI18n();

interface GreetingItem {
  id: string;
  text: string;
}

// Initialize local state from props
const localGreetings = ref<GreetingItem[]>(
  (props.greetings || []).map((text) => ({
    id: uuidv4(),
    text,
  })),
);

const localFirstMes = ref<string>(props.firstMes);

// Watch for changes in local state and emit updates immediately
// This ensures live saving as the user types or reorders
watch(
  localGreetings,
  (newVal) => {
    emit(
      'update:greetings',
      newVal.map((item) => item.text),
    );
  },
  { deep: true },
);

watch(localFirstMes, (newVal) => {
  emit('update:firstMes', newVal);
});

function addGreeting() {
  localGreetings.value.push({
    id: uuidv4(),
    text: '',
  });
}

function removeGreeting(index: number) {
  localGreetings.value.splice(index, 1);
}

function updateGreeting(index: number, text: string) {
  localGreetings.value[index].text = text;
}

function swapWithFirstMes(index: number) {
  const oldGreeting = localGreetings.value[index].text;
  const oldFirstMes = localFirstMes.value;
  localGreetings.value[index].text = oldFirstMes;
  localFirstMes.value = oldGreeting;
}
</script>

<template>
  <div class="alternate-greetings-content">
    <div v-if="localGreetings.length === 0" class="empty-list">
      {{ t('characterEditor.alternateGreetings.empty') }}
    </div>

    <DraggableList v-model:items="localGreetings" item-key="id" handle-class="drag-handle" class="greetings-list">
      <template #default="{ item, index }">
        <div class="greeting-item">
          <div class="drag-handle">
            <Icon icon="fa-grip-vertical" />
          </div>
          <div class="greeting-input-wrapper">
            <Textarea
              :model-value="item.text"
              :rows="2"
              :placeholder="t('characterEditor.alternateGreetings.placeholder')"
              @update:model-value="updateGreeting(index, $event)"
            />
          </div>
          <Button
            variant="ghost"
            icon="fa-right-left"
            :title="t('characterEditor.alternateGreetings.swapTooltip')"
            @click="swapWithFirstMes(index)"
          />
          <Button variant="danger" icon="fa-trash" @click="removeGreeting(index)" />
        </div>
      </template>
    </DraggableList>

    <div class="add-button-container">
      <Button icon="fa-plus" @click="addGreeting">
        {{ t('common.add') }}
      </Button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.alternate-greetings-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.greetings-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.greeting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--black-30a);
  padding: 8px;
  border-radius: var(--base-border-radius);
  border: 1px solid var(--theme-border-color);
}

:deep(.swap-button) {
  opacity: 0.7;

  &:hover {
    opacity: 1;
  }
}

.drag-handle {
  cursor: grab;
  padding: 8px 4px;
  opacity: 0.5;
  color: var(--theme-text-color);
  display: flex;
  align-items: center;

  &:hover {
    opacity: 1;
  }

  &:active {
    cursor: grabbing;
  }
}

.greeting-input-wrapper {
  flex-grow: 1;

  :deep(.text-pole) {
    margin: 0;
  }
}

.add-button-container {
  display: flex;
  justify-content: center;
  margin-top: 4px;
}

.empty-list {
  text-align: center;
  opacity: 0.6;
  font-style: italic;
  padding: 16px;
  border: 1px dashed var(--theme-border-color);
  border-radius: var(--base-border-radius);
}
</style>
