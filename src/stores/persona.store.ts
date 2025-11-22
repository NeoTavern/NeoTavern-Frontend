import { defineStore } from 'pinia';
import { ref, computed, toRaw, nextTick } from 'vue';
import { useSettingsStore } from './settings.store';
import { useUiStore } from './ui.store';
import {
  fetchAllPersonaAvatars,
  deletePersonaAvatar,
  uploadPersonaAvatar as apiUploadPersonaAvatar,
} from '../api/personas';
import { type Persona, type PersonaDescription, POPUP_TYPE, POPUP_RESULT, type Character } from '../types';
import { toast } from '../composables/useToast';
import { useStrictI18n } from '../composables/useStrictI18n';
import { usePopupStore } from './popup.store';
import { getBase64Async } from '../utils/file';
import { eventEmitter } from '../utils/event-emitter';
import { default_user_avatar } from '../constants';
import { getThumbnailUrl } from '../utils/image';
import { uuidv4 } from '../utils/common';

export const usePersonaStore = defineStore('persona', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();
  const popupStore = usePopupStore();

  const allPersonaAvatars = ref<string[]>([]);
  const activePersonaId = ref<string | null>(null);
  const lastAvatarUpdate = ref(Date.now());

  const personas = computed<Persona[]>({
    get: () => settingsStore.settings.persona.personas,
    set: (value) => {
      settingsStore.settings.persona.personas = value;
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
      title: '',
    };
  }

  async function initialize() {
    await settingsStore.waitForSettings();
    await refreshPersonas();
    const defaultPersonaId = settingsStore.settings.persona.defaultPersonaId;
    if (defaultPersonaId && personas.value.some((p) => p.avatarId === defaultPersonaId)) {
      await setActivePersona(defaultPersonaId);
    } else if (personas.value.length > 0) {
      await setActivePersona(personas.value[0].avatarId);
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
    if (activePersonaId.value === avatarId) return;
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
      // The change will be saved by the settings store watcher
      await nextTick();
      await eventEmitter.emit('persona:updated', updatedPersona);
    }
  }

  async function updateActivePersonaName() {
    if (!activePersona.value) return;

    const { result, value: newName } = await popupStore.show({
      title: t('personaManagement.rename.title'),
      content: t('personaManagement.rename.prompt'),
      type: POPUP_TYPE.INPUT,
      inputValue: activePersona.value.name,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE && newName && activePersonaId.value) {
      const index = personas.value.findIndex((p) => p.avatarId === activePersonaId.value);
      if (index > -1) {
        const updatedPersona = { ...personas.value[index], name: newName };
        personas.value.splice(index, 1, updatedPersona);
        // also update the main username if this is the active persona
        uiStore.activePlayerName = newName;
        await nextTick();
        await eventEmitter.emit('persona:updated', updatedPersona);
      }
    }
  }

  async function uploadPersonaAvatar(avatar: string | null, file: File, skipCrop = false) {
    if (!avatar) return;

    let cropData;
    if (!settingsStore.settings.ui.avatars.neverResize && !skipCrop) {
      const dataUrl = await getBase64Async(file);
      const { result, value } = await popupStore.show({
        title: t('popup.cropAvatar.title'),
        type: POPUP_TYPE.CROP,
        cropImage: dataUrl,
        wide: true,
      });
      if (result !== POPUP_RESULT.AFFIRMATIVE) return;
      cropData = value;
    }

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('overwrite_name', avatar);

    try {
      await apiUploadPersonaAvatar(formData, cropData);
      lastAvatarUpdate.value = Date.now();
      toast.success('Avatar updated successfully.');
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      toast.error('Failed to update avatar.');
    }
  }

  async function deletePersona(avatarId: string) {
    try {
      await deletePersonaAvatar(avatarId);

      personas.value = personas.value.filter((p) => p.avatarId !== avatarId);

      if (settingsStore.settings.persona.defaultPersonaId === avatarId) {
        settingsStore.settings.persona.defaultPersonaId = null;
      }
      // TODO: Handle chat and character locks

      toast.success(t('personaManagement.delete.success'));

      if (activePersonaId.value === avatarId) {
        const nextPersona = personas.value.length > 0 ? personas.value[0].avatarId : null;
        await setActivePersona(nextPersona);
      }
      await nextTick();
      await eventEmitter.emit('persona:deleted', avatarId);
    } catch (error) {
      console.error('Failed to delete persona:', error);
      toast.error(t('personaManagement.delete.error'));
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
      await uploadPersonaAvatar(newAvatarId, file, true);

      const newPersona: Persona = {
        ...JSON.parse(JSON.stringify(persona)),
        avatarId: newAvatarId,
        name: newName,
      };

      personas.value.push(newPersona);
      toast.success(t('personaManagement.duplicate.success', { name: persona.name }));
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
    await uploadPersonaAvatar(newAvatarId, defaultPersonaAvatar, true);
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

      await uploadPersonaAvatar(newAvatarId, file, true);

      const newPersona: Persona = {
        ...createDefaultDescription(),
        avatarId: newAvatarId,
        name: character.name,
        description: character.description || '',
      };

      personas.value.push(newPersona);
      toast.success(t('persona.createFromCharacter.success', { name: character.name }));
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
      toast.info(t('personaManagement.default.removed'));
    } else {
      settingsStore.settings.persona.defaultPersonaId = avatarId;
      toast.success(t('personaManagement.default.set'));
    }
  }

  async function toggleCharacterConnection(personaId: string, characterAvatar: string) {
    const persona = personas.value.find((p) => p.avatarId === personaId);
    if (!persona) return;

    if (!persona.connections) persona.connections = [];

    const index = persona.connections.findIndex((c) => c.id === characterAvatar);
    if (index !== -1) {
      persona.connections.splice(index, 1);
      toast.info(t('personaManagement.connections.characterRemoved'));
    } else {
      persona.connections.push({ id: characterAvatar });
      toast.success(t('personaManagement.connections.characterAdded'));
    }
    // Force update to trigger watchers if necessary, although reactive array methods should work.
    // We rely on the settings store deep watcher.
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
    updateActivePersonaName,
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
