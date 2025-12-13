<script setup lang="ts">
import { indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt, ViewUpdate } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    placeholder?: string;
    autofocus?: boolean;
    minHeight?: string;
    maxHeight?: string;
    language?: 'markdown' | 'css';
    ariaLabel?: string;
    id?: string;
  }>(),
  {
    disabled: false,
    placeholder: '',
    autofocus: false,
    minHeight: 'auto',
    maxHeight: 'none',
    language: 'markdown',
    ariaLabel: undefined,
    id: undefined,
  },
);

const { t } = useStrictI18n();

const emit = defineEmits(['update:modelValue', 'focus', 'blur']);

const editorContainer = ref<HTMLElement>();
let editorView: EditorView | null = null;
const readOnlyCompartment = new Compartment();
const languageCompartment = new Compartment();

// Custom theme to match application styles
const appTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--theme-text-color)',
      backgroundColor: 'var(--black-30a)',
      border: '1px solid var(--theme-border-color)',
      borderRadius: 'var(--base-border-radius)',
      fontSize: 'var(--font-size-main)',
      fontFamily: 'var(--font-family-mono, monospace)',
      minHeight: props.minHeight,
      maxHeight: props.maxHeight,
      overflow: 'hidden',
    },
    '&.cm-focused': {
      outline: 'none',
      borderColor: 'var(--theme-underline-color)',
      backgroundColor: 'var(--black-50a)',
    },
    '.cm-content': {
      padding: 'var(--textarea-padding-y) var(--textarea-padding-x)',
      caretColor: 'var(--theme-text-color)',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
      overflow: 'auto',
    },
    '.cm-gutters': {
      display: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--white-20a)',
    },
    '.cm-placeholder': {
      color: 'var(--theme-emphasis-color)',
    },
    // Selection
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--color-accent-cobalt-30a) !important',
    },
    // Basic Syntax Highlighting matching dark theme generic colors
    '.cm-header': { color: 'var(--color-golden)', fontWeight: 'bold' },
    '.cm-strong': { fontWeight: 'bold' },
    '.cm-em': { fontStyle: 'italic' },
    '.cm-link': { color: 'var(--color-info-cobalt)', textDecoration: 'underline' },
    '.cm-code': { fontFamily: 'var(--font-family-mono)', backgroundColor: 'var(--white-20a)', borderRadius: '3px' },
  },
  { dark: true },
);

const getLanguageExtension = (lang: 'markdown' | 'css') => {
  return lang === 'css' ? css() : markdown();
};

const initEditor = () => {
  if (!editorContainer.value) return;

  const startState = EditorState.create({
    doc: props.modelValue,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      languageCompartment.of(getLanguageExtension(props.language)),
      appTheme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        'aria-label': props.ariaLabel || t('a11y.codeMirrorEditor.label'),
        'aria-multiline': 'true',
        ...(props.id ? { id: props.id } : {}),
      }),
      EditorView.updateListener.of((v: ViewUpdate) => {
        if (v.docChanged) {
          emit('update:modelValue', v.state.doc.toString());
        }
        if (v.focusChanged) {
          if (v.view.hasFocus) emit('focus');
          else emit('blur');
        }
      }),
      props.placeholder ? placeholderExt(props.placeholder) : [],
    ],
  });

  editorView = new EditorView({
    state: startState,
    parent: editorContainer.value,
  });

  if (props.autofocus) {
    editorView.focus();
  }
};

onMounted(() => {
  initEditor();
});

onBeforeUnmount(() => {
  if (editorView) {
    editorView.destroy();
  }
});

// Watch for external value changes
watch(
  () => props.modelValue,
  (newVal) => {
    if (editorView && newVal !== editorView.state.doc.toString()) {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: newVal },
      });
    }
  },
);

// Watch for disabled state
watch(
  () => props.disabled,
  (val) => {
    if (editorView) {
      editorView.dispatch({
        effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(val)),
      });
    }
  },
);

// Watch for language changes
watch(
  () => props.language,
  (newLang) => {
    if (editorView) {
      editorView.dispatch({
        effects: languageCompartment.reconfigure(getLanguageExtension(newLang)),
      });
    }
  },
);

defineExpose({
  focus: () => editorView?.focus(),
});
</script>

<template>
  <div ref="editorContainer" class="codemirror-wrapper"></div>
</template>

<style scoped>
.codemirror-wrapper {
  width: 100%;
  /* Flex grow if parent allows, but ensure height */
  display: flex;
  flex-direction: column;
}
</style>
