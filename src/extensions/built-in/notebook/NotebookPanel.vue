<script setup lang="ts">
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { SplitPane } from '../../../components/common';
import { Button } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import './style.scss';
import type { Note, NotebookSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<NotebookSettings>;
}>();

// TODO: i18n

// --- Component State ---
const notes = ref<Note[]>([]);
const activeNoteId = ref<string | null>(null);
const isPaneCollapsed = ref(false);
const debounceTimer = ref<number | null>(null);

const activeNote = computed(() => notes.value.find((note) => note.id === activeNoteId.value) ?? null);

// --- Tiptap Editor ---
const editor = useEditor({
  content: '',
  extensions: [StarterKit, Image],
  editorProps: {
    attributes: {
      class: 'ProseMirror',
    },
  },
});

const addImage = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const src = e.target?.result as string;
        if (src) {
          editor.value?.chain().focus().setImage({ src }).run();
        }
      };
      reader.readAsDataURL(file); // Reads the file as a Base64 string
    }
  };
  input.click();
};

// --- Data Persistence ---
const saveNotes = () => {
  props.api.settings.set('notes', notes.value);
  props.api.settings.save();
};

const saveUiState = () => {
  props.api.settings.set('activeNoteId', activeNoteId.value);
  props.api.settings.set('isPaneCollapsed', isPaneCollapsed.value);
  props.api.settings.save();
};

const saveContent = (content: string) => {
  if (activeNote.value) {
    const note = notes.value.find((n) => n.id === activeNote.value!.id);
    if (note && note.content !== content) {
      note.content = content;
      const match = content.match(/<h[1-3]>(.*?)<\/h[1-3]>/);
      note.title = match ? match[1].trim().substring(0, 50) : 'Untitled Note';
      saveNotes();
    }
  }
};

// --- Tiptap Update Handler ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const onUpdate = ({ editor: tiptapEditor }: { editor: any }) => {
  if (debounceTimer.value) {
    clearTimeout(debounceTimer.value);
  }
  debounceTimer.value = window.setTimeout(() => {
    saveContent(tiptapEditor.getHTML());
  }, 500); // 500ms debounce
};

watch(editor, (newEditor, oldEditor) => {
  if (newEditor) newEditor.on('update', onUpdate);
  if (oldEditor) oldEditor.off('update', onUpdate);
});

// --- Note Management ---
const addNote = () => {
  const newNote: Note = {
    id: props.api.uuid(),
    title: 'New Note',
    content: '<h1>New Note</h1><p>Start writing here...</p>',
    createdAt: Date.now(),
  };
  notes.value.unshift(newNote);
  saveNotes();
  selectNote(newNote.id);
};

const deleteNote = async (noteId: string) => {
  const { result } = await props.api.ui.showPopup({
    title: 'Delete Note',
    okButton: 'common.delete',
    cancelButton: 'common.cancel',
  });

  if (result === 1) {
    const index = notes.value.findIndex((n) => n.id === noteId);
    if (index === -1) return;
    notes.value.splice(index, 1);
    if (activeNoteId.value === noteId) {
      const newActiveNote = notes.value[index] || notes.value[index - 1] || null;
      selectNote(newActiveNote?.id ?? null);
    }
    saveNotes();
  }
};

const selectNote = (noteId: string | null) => {
  if (editor.value && activeNote.value) {
    saveContent(editor.value.getHTML());
  }
  activeNoteId.value = noteId;
  const newContent = activeNote.value?.content ?? '';
  editor.value?.commands.setContent(newContent, { emitUpdate: false });
  saveUiState();
};

const updatePaneCollapsed = (collapsed: boolean) => {
  isPaneCollapsed.value = collapsed;
  saveUiState();
};

// --- Lifecycle Hooks ---
onMounted(() => {
  const savedSettings = props.api.settings.get();
  notes.value = savedSettings?.notes ?? [];
  isPaneCollapsed.value = savedSettings?.isPaneCollapsed ?? false;

  if (notes.value.length === 0) {
    const welcomeNote: Note = {
      id: props.api.uuid(),
      title: 'Welcome!',
      content: '<h1>Welcome to your Notebook!</h1><p>You can start taking notes here.</p>',
      createdAt: Date.now(),
    };
    notes.value.push(welcomeNote);
    activeNoteId.value = welcomeNote.id;
    saveNotes();
    saveUiState();
  } else {
    activeNoteId.value = savedSettings?.activeNoteId ?? notes.value[0]?.id ?? null;
  }

  if (activeNote.value) {
    editor.value?.commands.setContent(activeNote.value.content, { emitUpdate: false });
  }
});

onBeforeUnmount(() => {
  if (editor.value) {
    if (debounceTimer.value) clearTimeout(debounceTimer.value);
    saveContent(editor.value.getHTML());
    editor.value.off('update', onUpdate);
    editor.value.destroy();
  }
});

// --- Toolbar Definition ---
type ToolbarItem =
  | { type: 'divider' }
  | { type?: undefined; action: () => void; icon: string; name: string; level?: number };

const toolbarActions: ToolbarItem[] = [
  { action: () => editor.value?.chain().focus().toggleBold().run(), icon: 'fa-bold', name: 'bold' },
  { action: () => editor.value?.chain().focus().toggleItalic().run(), icon: 'fa-italic', name: 'italic' },
  { action: () => editor.value?.chain().focus().toggleStrike().run(), icon: 'fa-strikethrough', name: 'strike' },
  { action: () => editor.value?.chain().focus().toggleCode().run(), icon: 'fa-code', name: 'code' },
  { type: 'divider' },
  { action: addImage, icon: 'fa-image', name: 'image' },
  { type: 'divider' },
  {
    action: () => editor.value?.chain().focus().toggleHeading({ level: 1 }).run(),
    icon: 'fa-heading',
    name: 'heading',
    level: 1,
  },
  {
    action: () => editor.value?.chain().focus().toggleHeading({ level: 2 }).run(),
    icon: 'fa-heading',
    name: 'heading',
    level: 2,
  },
  {
    action: () => editor.value?.chain().focus().toggleHeading({ level: 3 }).run(),
    icon: 'fa-heading',
    name: 'heading',
    level: 3,
  },
  { type: 'divider' },
  { action: () => editor.value?.chain().focus().toggleBulletList().run(), icon: 'fa-list-ul', name: 'bulletList' },
  { action: () => editor.value?.chain().focus().toggleOrderedList().run(), icon: 'fa-list-ol', name: 'orderedList' },
  { action: () => editor.value?.chain().focus().toggleCodeBlock().run(), icon: 'fa-file-code', name: 'codeBlock' },
  { action: () => editor.value?.chain().focus().toggleBlockquote().run(), icon: 'fa-quote-right', name: 'blockquote' },
  { type: 'divider' },
  { action: () => editor.value?.chain().focus().setHorizontalRule().run(), icon: 'fa-minus', name: 'horizontalRule' },
  {
    action: () => editor.value?.chain().focus().setHardBreak().run(),
    icon: 'fa-right-to-bracket fa-rotate-90',
    name: 'hardBreak',
  },
];
</script>

<template>
  <div class="notebook-panel">
    <SplitPane
      :initial-width="240"
      :min-width="180"
      :max-width="500"
      :collapsed="isPaneCollapsed"
      @update:collapsed="updatePaneCollapsed"
    >
      <template #side>
        <div class="notebook-panel__sidebar-header">
          <span>Notes</span>
          <Button icon="fa-solid fa-plus" title="New Note" variant="ghost" @click="addNote" />
        </div>
        <div class="notebook-panel__note-list">
          <div
            v-for="note in notes"
            :key="note.id"
            class="notebook-panel__note-item"
            :class="{ 'is-active': note.id === activeNoteId }"
            :title="note.title"
            @click="selectNote(note.id)"
          >
            <span class="notebook-panel__note-title">{{ note.title }}</span>
            <Button icon="fa-solid fa-trash" title="Delete Note" variant="ghost" @click.stop="deleteNote(note.id)" />
          </div>
        </div>
      </template>
      <template #main>
        <div v-if="editor && activeNote" class="notebook-panel__main-content">
          <div class="notebook-panel__toolbar">
            <template v-for="(item, index) in toolbarActions" :key="index">
              <div v-if="item.type === 'divider'" class="toolbar-divider" />
              <button
                v-else
                type="button"
                class="toolbar-button"
                :class="{
                  'is-active':
                    item.name &&
                    (item.level ? editor.isActive(item.name, { level: item.level }) : editor.isActive(item.name)),
                }"
                :title="item.name"
                @click="item.action"
              >
                <i class="fa-solid" :class="item.icon" />
              </button>
            </template>
          </div>
          <EditorContent class="notebook-panel__editor" :editor="editor" />
        </div>
        <div v-else>
          <p style="text-align: center; padding: 20px">Select a note to start editing, or create a new one.</p>
        </div>
      </template>
    </SplitPane>
  </div>
</template>
