<script setup lang="ts">
import { ref, type PropType, computed } from 'vue';
import { WorldInfoPosition, type WorldInfoEntry } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { slideTransitionHooks } from '../../utils/dom';

const props = defineProps({
  modelValue: {
    type: Object as PropType<WorldInfoEntry>,
    required: true,
  },
});

const emit = defineEmits(['update:modelValue', 'delete', 'duplicate', 'move']);
const { t } = useStrictI18n();
const { beforeEnter, enter, afterEnter, beforeLeave, leave } = slideTransitionHooks;

const isExpanded = ref(false);
const isAdditionalSourcesExpanded = ref(false);

const isAtDepth = computed(() => props.modelValue.position === WorldInfoPosition.AT_DEPTH); // WorldInfoPosition.AT_DEPTH

function updateValue<K extends keyof WorldInfoEntry>(key: K, value: WorldInfoEntry[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

const entryState = computed({
  get() {
    if (props.modelValue.constant) return 'constant';
    if (props.modelValue.vectorized) return 'vectorized';
    return 'normal';
  },
  set(value: 'constant' | 'normal' | 'vectorized') {
    switch (value) {
      case 'constant':
        updateValue('constant', true);
        updateValue('vectorized', false);
        break;
      case 'vectorized':
        updateValue('constant', false);
        updateValue('vectorized', true);
        break;
      case 'normal':
      default:
        updateValue('constant', false);
        updateValue('vectorized', false);
        break;
    }
  },
});
</script>

<template>
  <div class="world-entry" :class="{ 'is-disabled': modelValue.disable }">
    <form class="world-entry__form">
      <div class="inline-drawer">
        <div class="inline-drawer-header">
          <div class="world-entry__header-controls">
            <i
              class="fa-solid inline-drawer-icon"
              :class="isExpanded ? 'fa-circle-chevron-up' : 'fa-circle-chevron-down'"
              @click="isExpanded = !isExpanded"
            ></i>
            <i
              class="fa-solid"
              :class="modelValue.disable ? 'fa-toggle-off' : 'fa-toggle-on'"
              @click="updateValue('disable', !modelValue.disable)"
              :title="t('worldInfo.entry.toggle')"
            ></i>
            <textarea
              class="text-pole"
              rows="1"
              :value="modelValue.comment"
              @input="updateValue('comment', ($event.target as HTMLTextAreaElement).value)"
              :placeholder="t('worldInfo.entry.titlePlaceholder')"
            ></textarea>
            <select
              class="text-pole world-entry__state-selector"
              :title="t('worldInfo.entry.entryState')"
              v-model="entryState"
            >
              <option value="constant">{{ t('worldInfo.entry.entryStates.constant') }}</option>
              <option value="normal">{{ t('worldInfo.entry.entryStates.normal') }}</option>
              <option value="vectorized">{{ t('worldInfo.entry.entryStates.vectorized') }}</option>
            </select>
            <div class="world-entry__header-controls__header-fields">
              <select
                class="text-pole"
                :title="t('worldInfo.entry.positionTooltip')"
                :value="modelValue.position"
                @change="
                  updateValue('position', Number(($event.target as HTMLSelectElement).value) as WorldInfoPosition)
                "
              >
                <option value="0">{{ t('worldInfo.entry.positionOptions.beforeChar') }}</option>
                <option value="1">{{ t('worldInfo.entry.positionOptions.afterChar') }}</option>
                <option value="5">{{ t('worldInfo.entry.positionOptions.beforeEM') }}</option>
                <option value="6">{{ t('worldInfo.entry.positionOptions.afterEM') }}</option>
                <option value="2">{{ t('worldInfo.entry.positionOptions.beforeAN') }}</option>
                <option value="3">{{ t('worldInfo.entry.positionOptions.afterAN') }}</option>
                <option value="4">{{ t('worldInfo.entry.positionOptions.atDepthSystem') }}</option>
                <option value="4">{{ t('worldInfo.entry.positionOptions.atDepthUser') }}</option>
                <option value="4">{{ t('worldInfo.entry.positionOptions.atDepthAI') }}</option>
                <option value="7">{{ t('worldInfo.entry.positionOptions.outlet') }}</option>
              </select>
              <input
                v-show="isAtDepth"
                type="number"
                class="text-pole"
                :title="t('worldInfo.entry.depth')"
                :value="modelValue.depth"
                @input="updateValue('depth', Number(($event.target as HTMLInputElement).value))"
              />
              <input
                type="number"
                class="text-pole"
                :title="t('worldInfo.entry.order')"
                :value="modelValue.order"
                @input="updateValue('order', Number(($event.target as HTMLInputElement).value))"
              />
              <input
                type="number"
                class="text-pole"
                :title="t('worldInfo.entry.trigger')"
                :value="modelValue.probability"
                @input="updateValue('probability', Number(($event.target as HTMLInputElement).value))"
                min="0"
                max="100"
              />
            </div>
          </div>
          <div class="world-entry__actions">
            <i class="menu-button fa-solid fa-right-left" :title="t('worldInfo.entry.move')" @click="$emit('move')"></i>
            <i
              class="menu-button fa-solid fa-paste"
              :title="t('worldInfo.entry.duplicate')"
              @click="$emit('duplicate')"
            ></i>
            <i
              class="menu-button fa-solid fa-trash-can"
              :title="t('worldInfo.entry.delete')"
              @click="$emit('delete')"
            ></i>
          </div>
        </div>

        <transition
          name="slide-js"
          @before-enter="beforeEnter"
          @enter="enter"
          @after-enter="afterEnter"
          @before-leave="beforeLeave"
          @leave="leave"
        >
          <div v-show="isExpanded" class="inline-drawer-content world-entry__content">
            <!-- Keywords and Logic -->
            <div class="world-entry__section">
              <div class="control-group flex-1">
                <small>{{ t('worldInfo.entry.primaryKeywords') }}</small>
                <textarea
                  class="text-pole"
                  rows="1"
                  :value="modelValue.key.join(', ')"
                  @input="
                    updateValue(
                      'key',
                      ($event.target as HTMLTextAreaElement).value.split(',').map((k) => k.trim()),
                    )
                  "
                  :placeholder="t('worldInfo.entry.keywordsPlaceholder')"
                ></textarea>
              </div>
              <div class="control-group">
                <small>{{ t('worldInfo.entry.logic') }}</small>
                <select
                  class="text-pole"
                  :value="modelValue.selectiveLogic"
                  @change="updateValue('selectiveLogic', Number(($event.target as HTMLSelectElement).value))"
                >
                  <option value="0">{{ t('worldInfo.entry.logicOptions.andAny') }}</option>
                  <option value="3">{{ t('worldInfo.entry.logicOptions.andAll') }}</option>
                  <option value="1">{{ t('worldInfo.entry.logicOptions.notAll') }}</option>
                  <option value="2">{{ t('worldInfo.entry.logicOptions.notAny') }}</option>
                </select>
              </div>
              <div class="control-group flex-1">
                <small>{{ t('worldInfo.entry.optionalFilter') }}</small>
                <textarea
                  class="text-pole"
                  rows="1"
                  :value="modelValue.keysecondary.join(', ')"
                  @input="
                    updateValue(
                      'keysecondary',
                      ($event.target as HTMLTextAreaElement).value.split(',').map((k) => k.trim()),
                    )
                  "
                  :placeholder="t('worldInfo.entry.filterPlaceholder')"
                ></textarea>
              </div>
            </div>

            <!-- Content -->
            <div class="world-entry__section u-flex-col">
              <label class="u-flex u-justify-between">
                <small>{{ t('worldInfo.entry.content') }}</small>
                <small>(UID: {{ modelValue.uid }})</small>
              </label>
              <textarea
                class="text-pole"
                rows="6"
                :value="modelValue.content"
                @input="updateValue('content', ($event.target as HTMLTextAreaElement).value)"
                :placeholder="t('worldInfo.entry.contentPlaceholder')"
              ></textarea>
              <div class="world-entry__checkbox-grid">
                <label class="checkbox-label" :title="t('worldInfo.entry.nonRecursableHint')">
                  <input type="checkbox" :checked="modelValue.excludeRecursion" />
                  <span>{{ t('worldInfo.entry.nonRecursable') }}</span>
                </label>
                <label class="checkbox-label" :title="t('worldInfo.entry.preventRecursionHint')">
                  <input type="checkbox" :checked="modelValue.preventRecursion" />
                  <span>{{ t('worldInfo.entry.preventRecursion') }}</span>
                </label>
                <label class="checkbox-label" :title="t('worldInfo.entry.delayUntilRecursionHint')">
                  <input type="checkbox" :checked="!!modelValue.delayUntilRecursion" />
                  <span>{{ t('worldInfo.entry.delayUntilRecursion') }}</span>
                </label>
                <label class="checkbox-label" :title="t('worldInfo.entry.ignoreBudgetHint')">
                  <input type="checkbox" :checked="modelValue.ignoreBudget" />
                  <span>{{ t('worldInfo.entry.ignoreBudget') }}</span>
                </label>
              </div>
            </div>

            <!-- Additional Matching Sources -->
            <div class="additional-sources inline-drawer">
              <div class="inline-drawer-header" @click="isAdditionalSourcesExpanded = !isAdditionalSourcesExpanded">
                <b>{{ t('worldInfo.entry.additionalSources') }}</b>
                <div
                  class="fa-solid fa-circle-chevron-down inline-drawer-icon"
                  :class="{ 'is-open': isAdditionalSourcesExpanded }"
                ></div>
              </div>
              <transition
                name="slide-js"
                @before-enter="beforeEnter"
                @enter="enter"
                @after-enter="afterEnter"
                @before-leave="beforeLeave"
                @leave="leave"
              >
                <div v-show="isAdditionalSourcesExpanded" class="inline-drawer-content world-entry__checkbox-grid">
                  <label class="checkbox-label">
                    <input type="checkbox" :checked="modelValue.matchCharacterDescription" />
                    <span>{{ t('worldInfo.entry.charDescription') }}</span>
                  </label>
                  <label class="checkbox-label">
                    <input type="checkbox" :checked="modelValue.matchPersonaDescription" />
                    <span>{{ t('worldInfo.entry.personaDescription') }}</span>
                  </label>
                  <label class="checkbox-label">
                    <input type="checkbox" :checked="modelValue.matchCharacterPersonality" />
                    <span>{{ t('worldInfo.entry.charPersonality') }}</span>
                  </label>
                  <label class="checkbox-label">
                    <input type="checkbox" :checked="modelValue.matchCharacterDepthPrompt" />
                    <span>{{ t('worldInfo.entry.charNote') }}</span>
                  </label>
                  <label class="checkbox-label">
                    <input type="checkbox" :checked="modelValue.matchScenario" />
                    <span>{{ t('worldInfo.entry.scenario') }}</span>
                  </label>
                  <label class="checkbox-label">
                    <input type="checkbox" :checked="modelValue.matchCreatorNotes" />
                    <span>{{ t('worldInfo.entry.creatorNotes') }}</span>
                  </label>
                </div>
              </transition>
            </div>

            <!-- Grouping & Timed Effects -->
            <div class="world-entry__section">
              <div class="control-group flex-1">
                <small>
                  {{ t('worldInfo.entry.inclusionGroup') }}
                  <i class="fa-solid fa-circle-info" :title="t('worldInfo.entry.inclusionGroupHint')"></i>
                </small>
                <div class="u-flex u-items-center">
                  <input
                    type="text"
                    class="text-pole flex-1"
                    :placeholder="t('worldInfo.entry.inclusionGroupPlaceholder')"
                  />
                  <label class="checkbox-label" :title="t('worldInfo.entry.prioritizeHint')">
                    <input type="checkbox" :checked="modelValue.groupOverride" />
                    <span>{{ t('worldInfo.entry.prioritize') }}</span>
                  </label>
                </div>
              </div>
              <div class="control-group">
                <small>{{ t('worldInfo.entry.groupWeight') }}</small>
                <input type="number" class="text-pole" :value="modelValue.groupWeight" />
              </div>
              <div class="control-group">
                <small :title="t('worldInfo.entry.stickyHint')">{{ t('worldInfo.entry.sticky') }}</small>
                <div class="input-with-unit">
                  <input
                    type="number"
                    class="text-pole"
                    :value="modelValue.sticky"
                    :placeholder="t('worldInfo.entry.nonSticky')"
                  />
                  <span class="unit">{{ t('worldInfo.entry.stickyUnit') }}</span>
                </div>
              </div>
              <div class="control-group">
                <small :title="t('worldInfo.entry.cooldownHint')">{{ t('worldInfo.entry.cooldown') }}</small>
                <div class="input-with-unit">
                  <input
                    type="number"
                    class="text-pole"
                    :value="modelValue.cooldown"
                    :placeholder="t('worldInfo.entry.noCooldown')"
                  />
                  <span class="unit">{{ t('worldInfo.entry.stickyUnit') }}</span>
                </div>
              </div>
              <div class="control-group">
                <small :title="t('worldInfo.entry.delayHint')">{{ t('worldInfo.entry.delay') }}</small>
                <div class="input-with-unit">
                  <input
                    type="number"
                    class="text-pole"
                    :value="modelValue.delay"
                    :placeholder="t('worldInfo.entry.noDelay')"
                  />
                  <span class="unit">{{ t('worldInfo.entry.stickyUnit') }}</span>
                </div>
              </div>
            </div>
            <!-- TODO: Add filters for characters/tags and generation triggers -->
          </div>
        </transition>
      </div>
    </form>
  </div>
</template>
