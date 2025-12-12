import { defineStore } from 'pinia';
import { computed, nextTick, ref, toRaw } from 'vue';
import {
  uploadPersonaAvatar as apiUploadPersonaAvatar,
  deletePersonaAvatar,
  fetchAllPersonaAvatars,
} from '../api/personas';
import { useStrictI18n } from '../composables/useStrictI18n';
import { toast } from '../composables/useToast';
import { default_user_avatar } from '../constants';
import { type Character, type CropData, type Persona, type PersonaDescription } from '../types';
import { getThumbnailUrl } from '../utils/character';
import { uuidv4 } from '../utils/commons';
import { eventEmitter } from '../utils/extensions';
import { useSettingsStore } from './settings.store';
import { useUiStore } from './ui.store';

export const usePersonaStore = defineStore('persona', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();

  const allPersonaAvatars = ref<string[]>([]);
  const lastAvatarUpdate = ref(Date.now());

  const personas = computed<Persona[]>({
    get: () => settingsStore.settings.persona.personas,
    set: (value) => {
      settingsStore.settings.persona.personas = value;
    },
  });

  const activePersonaId = computed<string | null>({
    get: () => settingsStore.settings.persona.activePersonaId ?? null,
    set: (value) => {
      settingsStore.settings.persona.activePersonaId = value;
    },
  });

  const activePersona = computed<Persona | null>(() => {
    return personas.value.find((p) => p.avatarId === activePersonaId.value) ?? null;
  });

  function createDefaultDescription(): Omit<Persona, 'avatarId' | 'name'> {
    return {
      description: '',
      lorebooks: [],
      connections: [],
    };
  }

  async function initialize() {
    await refreshPersonas();

    if (activePersonaId.value && personas.value.some((p) => p.avatarId === activePersonaId.value)) {
      await setActivePersona(activePersonaId.value);
    } else {
      const defaultPersonaId = settingsStore.settings.persona.defaultPersonaId;
      if (defaultPersonaId && personas.value.some((p) => p.avatarId === defaultPersonaId)) {
        await setActivePersona(defaultPersonaId);
      } else if (personas.value.length > 0) {
        await setActivePersona(personas.value[0].avatarId);
      }
    }
  }

  async function refreshPersonas() {
    try {
      allPersonaAvatars.value = await fetchAllPersonaAvatars();
      const currentPersonas = [...toRaw(personas.value)];
      let settingsChanged = false;

      // Add new personas for any new avatars
      for (const avatarId of allPersonaAvatars.value) {
        if (!currentPersonas.some((p) => p.avatarId === avatarId)) {
          currentPersonas.push({
            ...createDefaultDescription(),
            avatarId: avatarId,
            name: '[Unnamed Persona]',
          });
          settingsChanged = true;
        }
      }

      // Remove personas for deleted avatars
      const finalPersonas = currentPersonas.filter((p) => allPersonaAvatars.value.includes(p.avatarId));
      if (finalPersonas.length !== currentPersonas.length) {
        settingsChanged = true;
      }

      if (settingsChanged) {
        personas.value = finalPersonas;
      }
    } catch (error) {
      console.error('Failed to refresh personas:', error);
      toast.error('Could not load personas.');
    }
  }

  async function setActivePersona(avatarId: string | null) {
    if (!avatarId) return;
    const persona = personas.value.find((p) => p.avatarId === avatarId);

    if (activePersonaId.value === avatarId && uiStore.activePlayerAvatar === avatarId) return;

    if (persona) {
      activePersonaId.value = avatarId;
      uiStore.activePlayerName = persona.name;
      uiStore.activePlayerAvatar = persona.avatarId;

      if (settingsStore.settings.persona.showNotifications) {
        toast.info(t('personaManagement.activated', { name: persona.name }));
      }

      await nextTick();
      await eventEmitter.emit('persona:activated', persona);
    }
  }

  async function updateActivePersonaField<K extends keyof PersonaDescription>(field: K, value: PersonaDescription[K]) {
    if (!activePersona.value) return;
    const index = personas.value.findIndex((p) => p.avatarId === activePersona.value?.avatarId);
    if (index > -1) {
      const updatedPersona = { ...personas.value[index], [field]: value };
      personas.value.splice(index, 1, updatedPersona);
      await nextTick();
      await eventEmitter.emit('persona:updated', updatedPersona);
    }
  }

  async function renamePersona(avatarId: string, newName: string) {
    const index = personas.value.findIndex((p) => p.avatarId === avatarId);
    if (index > -1) {
      const updatedPersona = { ...personas.value[index], name: newName };
      personas.value.splice(index, 1, updatedPersona);

      if (activePersonaId.value === avatarId) {
        uiStore.activePlayerName = newName;
      }

      await nextTick();
      await eventEmitter.emit('persona:updated', updatedPersona);
    }
  }

  async function uploadPersonaAvatar(avatar: string | null, file: File, cropData?: CropData) {
    if (!avatar) return;

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('overwrite_name', avatar);

    try {
      await apiUploadPersonaAvatar(formData, cropData);
      lastAvatarUpdate.value = Date.now();
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      toast.error('Failed to update avatar.');
      throw error;
    }
  }

  async function deletePersona(avatarId: string) {
    try {
      try {
        await deletePersonaAvatar(avatarId);
      } catch {
        console.warn('Avatar deletion failed on server, ignoring.');
      }

      personas.value = personas.value.filter((p) => p.avatarId !== avatarId);

      if (settingsStore.settings.persona.defaultPersonaId === avatarId) {
        settingsStore.settings.persona.defaultPersonaId = null;
      }

      if (activePersonaId.value === avatarId) {
        const nextPersona = personas.value.length > 0 ? personas.value[0].avatarId : null;
        await setActivePersona(nextPersona);
      }
      await nextTick();
      await eventEmitter.emit('persona:deleted', avatarId);
    } catch (error) {
      console.error('Failed to delete persona:', error);
      toast.error(t('personaManagement.delete.error'));
      throw error;
    }
  }

  async function duplicatePersona(avatarId: string) {
    const persona = personas.value.find((p) => p.avatarId === avatarId);
    if (!persona) return;

    try {
      const newName = `${persona.name} (Copy)`;
      const url = getThumbnailUrl('persona', persona.avatarId);
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], 'avatar.png', { type: blob.type });

      const newAvatarId = `${uuidv4()}.png`;
      // Pass file directly, no crop needed for duplicate
      await uploadPersonaAvatar(newAvatarId, file);

      const newPersona: Persona = {
        ...JSON.parse(JSON.stringify(persona)),
        avatarId: newAvatarId,
        name: newName,
      };

      personas.value.push(newPersona);
      await nextTick();
      await eventEmitter.emit('persona:created', newPersona);
      await setActivePersona(newAvatarId);
    } catch (error) {
      console.error('Failed to duplicate persona:', error);
      toast.error(t('personaManagement.duplicate.error'));
    }
  }

  async function createPersona() {
    const newAvatarId = `${uuidv4()}.png`;
    const res = await fetch(default_user_avatar);
    const blob = await res.blob();
    const defaultPersonaAvatar = new File([blob], 'avatar.png', { type: 'image/png' });

    await uploadPersonaAvatar(newAvatarId, defaultPersonaAvatar);

    const newPersona: Persona = {
      ...createDefaultDescription(),
      avatarId: newAvatarId,
      name: '[Unnamed Persona]',
    };
    personas.value.push(newPersona);
    await setActivePersona(newAvatarId);
    await nextTick();
    await eventEmitter.emit('persona:created', newPersona);
  }

  async function createPersonaFromCharacter(character: Character) {
    try {
      const url = getThumbnailUrl('avatar', character.avatar);
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], 'avatar.png', { type: blob.type });

      const newAvatarId = `${uuidv4()}.png`;

      await uploadPersonaAvatar(newAvatarId, file);

      const newPersona: Persona = {
        ...createDefaultDescription(),
        avatarId: newAvatarId,
        name: character.name,
        description: character.description || '',
      };

      personas.value.push(newPersona);
      await nextTick();
      await eventEmitter.emit('persona:created', newPersona);
    } catch (error) {
      console.error('Failed to create persona from character', error);
      toast.error(t('persona.createFromCharacter.error'));
    }
  }

  function isDefault(avatarId: string): boolean {
    return settingsStore.settings.persona.defaultPersonaId === avatarId;
  }

  async function toggleDefault(avatarId: string) {
    if (settingsStore.settings.persona.defaultPersonaId === avatarId) {
      settingsStore.settings.persona.defaultPersonaId = null;
    } else {
      settingsStore.settings.persona.defaultPersonaId = avatarId;
    }
  }

  async function toggleCharacterConnection(personaId: string, characterAvatar: string) {
    const persona = personas.value.find((p) => p.avatarId === personaId);
    if (!persona) return;

    if (!persona.connections) persona.connections = [];

    const index = persona.connections.findIndex((c) => c.id === characterAvatar);
    if (index !== -1) {
      persona.connections.splice(index, 1);
    } else {
      persona.connections.push({ id: characterAvatar });
    }
  }

  function getLinkedPersona(characterAvatar: string): Persona | undefined {
    return personas.value.find((p) => p.connections?.some((c) => c.id === characterAvatar));
  }

  function isLinkedToCharacter(personaId: string, characterAvatar: string): boolean {
    const persona = personas.value.find((p) => p.avatarId === personaId);
    return !!persona?.connections?.some((c) => c.id === characterAvatar);
  }

  return {
    personas,
    activePersonaId,
    activePersona,
    lastAvatarUpdate,
    initialize,
    refreshPersonas,
    setActivePersona,
    updateActivePersonaField,
    renamePersona,
    uploadPersonaAvatar,
    deletePersona,
    duplicatePersona,
    createPersona,
    createPersonaFromCharacter,
    isDefault,
    toggleDefault,
    toggleCharacterConnection,
    getLinkedPersona,
    isLinkedToCharacter,
  };
});
