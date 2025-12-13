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
          <div
            class="drag-handle"
            role="button"
            :aria-label="t('common.dragHandle')"
            tabindex="0"
            @keydown.enter.prevent
            @keydown.space.prevent
          >
            <Icon icon="fa-grip-vertical" />
          </div>
          <div class="greeting-input-wrapper">
            <Textarea
              :model-value="item.text"
              :rows="6"
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
          <Button variant="danger" icon="fa-trash" :aria-label="t('common.delete')" @click="removeGreeting(index)" />
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
