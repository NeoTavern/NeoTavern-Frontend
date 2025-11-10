import { delay } from '../../utils/common';
import { humanizedDateTime } from '../../utils/date';
import { onlyUnique } from '../../utils/array';
import DOMPurify from 'dompurify';
import { Toast } from '../Toast';
import { activeCharacterIndex, characters, favoriteCharacterChecked } from '../../stores/character.store';
import { chat, chatMetadata } from '../../stores/chat.store';
import { createSave } from '../../stores/creation.store';
import { activeGroupId, groups, isGroupGenerating } from '../../stores/group.store';
import { isChatSaving, isSendPress, menuType, selectedButton, cropData } from '../../stores/ui.store';
import { worldNames } from '../../stores/world.store';
import type { MenuType, ThumbnailType } from '../../types';
import {
  animation_duration,
  animation_easing,
  DEFAULT_SAVE_EDIT_TIMEOUT,
  default_avatar,
  depth_prompt_depth_default,
  depth_prompt_role_default,
  talkativeness_default,
} from '../../constants';
import { clearChat, refreshChat, resetSelectedGroup } from '../Chat';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../Popup';
import { accountStorage } from '../../AccountStorage';
import { fetchAllCharacters, fetchCharacterByAvatar } from '../../api/characters';
import { fetchAllGroups } from '../../api/groups';
import { getBase64Async } from '../../utils/file';
import { powerUser } from '../../stores/settings.store';

// TODO: These need to be moved to a proper service/store
let saveCharactersPage = 0;

export class CharactersBlock {
  readonly searchButton = document.getElementById('rm-button-search') as HTMLDivElement;
  readonly searchForm = document.getElementById('form-character-search-form') as HTMLDivElement;
  constructor() {
    this.searchButton.addEventListener('click', () => {
      this.searchForm.classList.toggle('active');
    });
  }

  async init() {
    await refreshCharacters();
  }
}

export async function refreshCharacters() {
  try {
    const newCharacters = await fetchAllCharacters();

    const resolvedActiveIndex = activeCharacterIndex.get();
    const resolvedCharacters = characters.get();
    const previousAvatar = resolvedActiveIndex !== null ? resolvedCharacters[resolvedActiveIndex]?.avatar : null;

    for (let i = 0; i < newCharacters.length; i++) {
      newCharacters[i].name = DOMPurify.sanitize(newCharacters[i].name);

      // For dropped-in cards
      if (!newCharacters[i].chat) {
        newCharacters[i].chat = `${newCharacters[i].name} - ${humanizedDateTime()}`;
      }

      newCharacters[i].chat = String(newCharacters[i].chat);
    }
    characters.set(newCharacters);

    if (previousAvatar) {
      const newCharacterId = characters.get().findIndex((x) => x.avatar === previousAvatar);
      if (newCharacterId >= 0) {
        activeCharacterIndex.set(newCharacterId);
        await selectCharacterById(newCharacterId, { switchMenu: false });
      } else {
        Toast.error('The active character is no longer available. The page will be refreshed to prevent data loss.'); // TODO: Add callback on toast hidden, so that we can wait for user to see the message
        return location.reload();
      }
    }

    await refreshGroups();
    await printCharacters(true);
  } catch (error: any) {
    console.error('Failed to fetch characters:', error);
    if (error.message === 'overflow') {
      Toast.warning(
        'Character data length limit reached. To resolve this, set "performance.lazyLoadCharacters" to "true" in config.yaml and restart the server.',
      );
    }
  }
}

/**
 * Switches the currently selected character to the one with the given ID. (character index, not the character key!)
 *
 * If the character ID doesn't exist, if the chat is being saved, or if a group is being generated, this function does nothing.
 * If the character is different from the currently selected one, it will clear the chat and reset any selected character or group.
 * @param {boolean} [options.switchMenu=true] Whether to switch the right menu to the character edit menu if the character is already selected.
 * @returns {Promise<void>} A promise that resolves when the character is switched.
 */
export async function selectCharacterById(index: number, { switchMenu = true } = {}) {
  const resolvedCharacters = characters.get();

  if (resolvedCharacters[index] === undefined) {
    return;
  }

  if (isChatSaving.get()) {
    Toast.info('Please wait until the chat is saved before switching characters.', undefined, { timeOut: 5000 });
    return;
  }

  const resolvedActiveGroupId = activeGroupId.get();
  if (resolvedActiveGroupId && isGroupGenerating.get()) {
    return;
  }

  const resolvedActiveCharacterIndex = activeCharacterIndex.get();
  if (resolvedActiveGroupId || resolvedActiveCharacterIndex !== index) {
    //if clicked on a different character from what was currently selected
    if (!isSendPress.get()) {
      await clearChat();
      // cancelTtsPlay();
      resetSelectedGroup();
      // activeMessageEditIndex.set(null); // This should be handled by clearChat or a dedicated chat reset function
      selectedButton.set('character_edit');
      activeCharacterIndex.set(index);
      chat.set([]);
      chatMetadata.set({});
      await refreshChat();
    }
  } else {
    //if clicked on character that was already selected
    switchMenu && selectedButton.set('character_edit');
    await unshallowCharacter(resolvedActiveCharacterIndex);
    select_selected_character(resolvedActiveCharacterIndex, { switchMenu });
  }
}

/**
 * Loads all the data of a shallow character.
 */
export async function unshallowCharacter(characterIndex: number | null) {
  if (characterIndex === null) {
    console.debug('Null character cannot be unshallowed');
    return;
  }

  const character = characters.get()[characterIndex];
  if (!character) {
    console.debug('Character not found:', characterIndex);
    return;
  }

  // Character is not shallow
  if (!character.shallow) {
    return;
  }

  const avatar = character.avatar;
  if (!avatar) {
    console.debug('Character has no avatar field:', characterIndex);
    return;
  }

  await loadOneCharacter(avatar);
}

export async function loadOneCharacter(avatar: string) {
  try {
    const getData = await fetchCharacterByAvatar(avatar);
    getData['name'] = DOMPurify.sanitize(getData['name']);
    getData['chat'] = String(getData['chat']);

    const resolvedCharacters = characters.get();
    const indexOf = resolvedCharacters.findIndex((x) => x.avatar === avatar);

    if (indexOf !== -1) {
      resolvedCharacters[indexOf] = getData;
      characters.set([...resolvedCharacters]);
    } else {
      Toast.error(`Character ${avatar} not found in the list`, undefined, { timeOut: 5000 });
    }
  } catch (error) {
    console.error(error);
    Toast.error('Failed to load character details.');
  }
}

/**
 * Selects the right menu for displaying the character editor.
 */
export function select_selected_character(index: number, { switchMenu = true } = {}) {
  //character select
  select_rm_create({ switchMenu });
  switchMenu && setMenuType('character_edit');
  document.getElementById('delete_button')!.style.display = 'flex';
  document.getElementById('export_button')!.style.display = 'flex';

  //create text poles
  document.getElementById('rm_button_back')!.style.display = 'none';
  (document.getElementById('create_button') as HTMLInputElement).value = 'Save'; // what is the use case for this?
  document.getElementById('dupe_button')!.style.display = 'flex';
  document.getElementById('create_button_label')!.style.display = 'none';
  document.getElementById('char_connections_button')!.style.display = 'flex';

  const resolvedActiveGroupId = activeGroupId.get();
  const resolvedCharacters = characters.get();
  // Hide the chat scenario button if we're peeking the group member defs
  document.getElementById('set_chat_character_settings')!.style.display = resolvedActiveGroupId ? 'none' : 'flex';

  // Don't update the navbar name if we're peeking the group member defs
  if (resolvedActiveGroupId === null) {
    document.getElementById('rm_button_selected_ch')!.querySelector('h2')!.textContent = resolvedCharacters[index].name;
  }

  (document.getElementById('add_avatar_button') as HTMLInputElement).value = '';

  (document.getElementById('character_popup-button-h3') as HTMLHeadingElement).textContent =
    resolvedCharacters[index].name;
  (document.getElementById('character_name_pole') as HTMLInputElement).value = resolvedCharacters[index].name;
  (document.getElementById('description_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].description || '';
  (document.getElementById('character_world') as HTMLInputElement).value =
    resolvedCharacters[index].data?.extensions?.world || '';
  (document.getElementById('creator_notes_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].data?.creator_notes || resolvedCharacters[index].creatorcomment || '';
  // (document.getElementById('creator_notes_spoiler') as HTMLDivElement).innerHTML = formatCreatorNotes(
  //   resolvedCharacters[index].data?.creator_notes || resolvedCharacters[index].creatorcomment || '',
  //   resolvedCharacters[index].avatar,
  // ); // TODO: Implement formatCreatorNotes
  (document.getElementById('creator_notes_spoiler') as HTMLDivElement).innerHTML =
    resolvedCharacters[index].creatorcomment || '';
  (document.getElementById('character_version_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].data?.character_version || '';
  (document.getElementById('system_prompt_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].data?.system_prompt || '';
  (document.getElementById('post_history_instructions_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].data?.post_history_instructions || '';
  (document.getElementById('tags_textarea') as HTMLTextAreaElement).value = Array.isArray(
    resolvedCharacters[index].data?.tags,
  )
    ? resolvedCharacters[index].data.tags.join(', ')
    : '';
  (document.getElementById('creator_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].data?.creator || '';
  (document.getElementById('personality_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].personality || '';
  (document.getElementById('firstmessage_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].first_mes || '';

  (document.getElementById('scenario_pole') as HTMLInputElement).value = resolvedCharacters[index].scenario || '';
  (document.getElementById('depth_prompt_prompt') as HTMLInputElement).value =
    resolvedCharacters[index].data?.extensions?.depth_prompt?.prompt || '';
  (document.getElementById('depth_prompt_depth') as HTMLInputElement).value = String(
    resolvedCharacters[index].data?.extensions?.depth_prompt?.depth || depth_prompt_depth_default,
  );
  (document.getElementById('depth_prompt_role') as HTMLInputElement).value =
    resolvedCharacters[index].data?.extensions?.depth_prompt?.role || depth_prompt_role_default;
  (document.getElementById('talkativeness_slider') as HTMLInputElement).value = String(
    resolvedCharacters[index].talkativeness || talkativeness_default,
  );
  (document.getElementById('mes_example_textarea') as HTMLTextAreaElement).value =
    resolvedCharacters[index].mes_example || '';
  (document.getElementById('selected_chat_pole') as HTMLInputElement).value = resolvedCharacters[index].chat || '';
  (document.getElementById('create_date_pole') as HTMLInputElement).value = resolvedCharacters[index].create_date || '';
  (document.getElementById('avatar_url_pole') as HTMLInputElement).value = resolvedCharacters[index].avatar || '';
  (document.getElementById('chat_import_avatar_url') as HTMLInputElement).value =
    resolvedCharacters[index].avatar || '';
  (document.getElementById('chat_import_character_name') as HTMLInputElement).value =
    resolvedCharacters[index].name || '';
  (document.getElementById('character_json_data') as HTMLTextAreaElement).value =
    resolvedCharacters[index].json_data || '';

  updateFavButtonState(resolvedCharacters[index].fav === true || resolvedCharacters[index].fav == 'true');

  const avatarUrl =
    resolvedCharacters[index].avatar != 'none'
      ? getThumbnailUrl('avatar', resolvedCharacters[index].avatar)
      : default_avatar;
  (document.getElementById('avatar_load_preview') as HTMLImageElement).setAttribute('src', avatarUrl);
  (document.querySelector('.open_alternate_greetings') as HTMLDivElement).dataset.chid = String(index);
  (document.getElementById('set_character_world') as HTMLDivElement).dataset.chid = String(index);
  setWorldInfoButtonClass(index);
  checkEmbeddedWorld(index);

  document.getElementById('name_div')!.classList.remove('displayBlock');
  document.getElementById('name_div')!.classList.add('displayNone');
  document.getElementById('renameCharButton')!.style.display = 'flex';

  document.getElementById('form_create')!.setAttribute('actiontype', 'editcharacter');
  (document.querySelector('.form_create_bottom_buttons_block .chat_lorebook_button') as HTMLDivElement).style.display =
    'flex';

  const externalMediaState = isExternalMediaAllowed();
  document.getElementById('character_open_media_overrides')!.style.display = resolvedActiveGroupId ? 'none' : 'flex';
  document.getElementById('character_media_allowed_icon')!.style.display = externalMediaState ? 'flex' : 'none';
  document.getElementById('character_media_forbidden_icon')!.style.display = externalMediaState ? 'none' : 'flex';

  // Update some stuff about the char management dropdown
  (document.getElementById('character_source') as HTMLInputElement).disabled = !getCharacterSource(index);

  // eventSource.emit(event_types.CHARACTER_EDITOR_OPENED, index); // TODO: Implement

  // saveSettingsDebounced(); // TODO: Implement
}

/**
 * Selects the right menu for creating a new character.
 */
function select_rm_create({ switchMenu = true } = {}) {
  switchMenu && setMenuType('create');

  const resolvedSelectedButton = selectedButton.get();
  const resolvedCreateSave = createSave.get();
  if (resolvedSelectedButton == 'create' && resolvedCreateSave.avatar) {
    // const addAvatarInput = /** @type {HTMLInputElement} */ ($('#add_avatar_button').get(0));
    const addAvatarInput = document.getElementById('add_avatar_button') as HTMLInputElement;
    addAvatarInput.files = resolvedCreateSave.avatar;
    read_avatar_load(addAvatarInput);
  }

  switchMenu && selectRightMenuWithAnimation('rm_ch_create_block');

  document.getElementById('set_chat_character_settings')!.style.display = 'none';
  document.getElementById('delete_button_div')!.style.display = 'none';
  document.getElementById('delete_button')!.style.display = 'none';
  document.getElementById('export_button')!.style.display = 'none';
  document.getElementById('create_button_label')!.style.display = '';
  (document.getElementById('create_button') as HTMLInputElement).value = 'Create';
  document.getElementById('dupe_button')!.style.display = 'none';
  document.getElementById('char_connections_button')!.style.display = 'none';

  //create text poles
  document.getElementById('rm_button_back')!.style.display = '';
  document.getElementById('character_import_button')!.style.display = '';
  document.getElementById('character_popup-button-h3')!.textContent = 'Create character';
  (document.getElementById('character_name_pole') as HTMLInputElement).value = resolvedCreateSave.name;
  (document.getElementById('description_textarea') as HTMLTextAreaElement).value = resolvedCreateSave.description;
  (document.getElementById('character_world') as HTMLInputElement).value = resolvedCreateSave.world;
  (document.getElementById('creator_notes_textarea') as HTMLTextAreaElement).value = resolvedCreateSave.creator_notes;
  // document.getElementById('creator_notes_spoiler')!.innerHTML = formatCreatorNotes(
  //   resolvedCreateSave.creator_notes,
  //   '',
  // ); // TODO: Implement formatCreatorNotes
  document.getElementById('creator_notes_spoiler')!.innerHTML = resolvedCreateSave.creator_notes;
  (document.getElementById('post_history_instructions_textarea') as HTMLTextAreaElement).value =
    resolvedCreateSave.post_history_instructions;
  (document.getElementById('system_prompt_textarea') as HTMLTextAreaElement).value = resolvedCreateSave.system_prompt;
  (document.getElementById('tags_textarea') as HTMLTextAreaElement).value = resolvedCreateSave.tags;
  (document.getElementById('creator_textarea') as HTMLTextAreaElement).value = resolvedCreateSave.creator;
  (document.getElementById('character_version_textarea') as HTMLTextAreaElement).value =
    resolvedCreateSave.character_version;
  (document.getElementById('personality_textarea') as HTMLTextAreaElement).value = resolvedCreateSave.personality;
  (document.getElementById('firstmessage_textarea') as HTMLTextAreaElement).value = resolvedCreateSave.first_message;
  (document.getElementById('talkativeness_slider') as HTMLInputElement).value = String(
    resolvedCreateSave.talkativeness,
  );
  (document.getElementById('scenario_pole') as HTMLInputElement).value = resolvedCreateSave.scenario;
  (document.getElementById('depth_prompt_prompt') as HTMLInputElement).value = resolvedCreateSave.depth_prompt_prompt;
  (document.getElementById('depth_prompt_depth') as HTMLInputElement).value = String(
    resolvedCreateSave.depth_prompt_depth,
  );
  (document.getElementById('depth_prompt_role') as HTMLInputElement).value = resolvedCreateSave.depth_prompt_role;
  (document.getElementById('mes_example_textarea') as HTMLTextAreaElement).value = resolvedCreateSave.mes_example;
  (document.getElementById('character_json_data') as HTMLTextAreaElement).value = '';
  (document.getElementById('avatar_div') as HTMLDivElement).style.display = 'flex';
  (document.getElementById('avatar_load_preview') as HTMLImageElement).setAttribute('src', default_avatar);
  document.getElementById('renameCharButton')!.style.display = 'none';
  document.getElementById('name_div')!.classList.remove('displayNone');
  document.getElementById('name_div')!.classList.add('displayBlock');
  (document.querySelector('.open_alternate_greetings') as HTMLDivElement).dataset.chid = '-1';
  (document.getElementById('set_character_world') as HTMLDivElement).dataset.chid = '-1';

  setWorldInfoButtonClass(null, !!resolvedCreateSave.world);
  updateFavButtonState(false);
  checkEmbeddedWorld();

  (document.getElementById('form_create') as HTMLFormElement).setAttribute('actiontype', 'createcharacter');
  (document.querySelector('.form_create_bottom_buttons_block .chat_lorebook_button') as HTMLDivElement).style.display =
    'none';
  (document.getElementById('character_open_media_overrides') as HTMLDivElement).style.display = 'none';
}

export function setMenuType(value: MenuType) {
  menuType.set(value);
  // Allow custom CSS to see which menu type is active
  document.getElementById('right-nav-panel')!.dataset.menuType = menuType.get() ?? undefined;
}

/**
 * Processes the avatar image from the input element, allowing the user to crop it if necessary.
 */
async function read_avatar_load(input: HTMLInputElement): Promise<void> {
  if (input.files && input.files[0]) {
    if (selectedButton.get() === 'create') {
      createSave.set({ ...createSave.get(), avatar: input.files });
    }

    cropData.set(null);
    const file = input.files[0];
    const fileData = await getBase64Async(file);

    if (!powerUser.get().never_resize_avatars) {
      const dlg = new Popup('Set the crop position of the avatar image', POPUP_TYPE.CROP, '', { cropImage: fileData });
      const croppedImage = await dlg.show();

      if (!croppedImage) {
        return;
      }

      cropData.set(dlg.value);
      document.getElementById('avatar_load_preview')!.setAttribute('src', String(croppedImage.value));
    } else {
      document.getElementById('avatar_load_preview')!.setAttribute('src', fileData);
    }

    if (menuType.get() === 'create') {
      return;
    }

    // await createOrEditCharacter(); // TODO: Implement
    await delay(DEFAULT_SAVE_EDIT_TIMEOUT);

    const formData = new FormData(document.getElementById('form_create') as HTMLFormElement);
    if (!formData) throw new Error('Form data is null');
    await fetch(getThumbnailUrl('avatar', formData.get('avatar_url')!.toString()), {
      method: 'GET',
      cache: 'reload',
    });

    const messages = document.querySelectorAll<HTMLElement>('.mes');
    messages.forEach(async (el) => {
      const nameMatch = el.getAttribute('ch_name') === formData.get('ch_name')?.toString();
      if (el.getAttribute('is_system') === 'true' && !nameMatch) return;
      if (el.getAttribute('is_user') === 'true') return;

      if (nameMatch) {
        const previewSrc = document.getElementById('avatar_load_preview')?.getAttribute('src') || '';
        const avatar = el.querySelector<HTMLElement>('.avatar img');
        if (avatar) {
          avatar.setAttribute('src', default_avatar);
          await delay(1);
          avatar.setAttribute('src', previewSrc);
        }
      }
    });

    console.log('Avatar refreshed');
  }
}

/**
 * Gets the URL for a thumbnail of a specific type and file.
 * @param type The type of the thumbnail to get
 * @param file The file name or path for which to get the thumbnail URL
 * @param [t=false] Whether to add a cache-busting timestamp to the URL
 */
export function getThumbnailUrl(type: ThumbnailType, file: string, t = false) {
  return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}${t ? `&t=${Date.now()}` : ''}`;
}

export function selectRightMenuWithAnimation(selectedMenuId: string) {
  const displayModes = {
    rm_group_chats_block: 'flex',
    rm_api_block: 'grid',
    rm_characters_block: 'flex',
  };
  document.getElementById('result_info')!.style.display = selectedMenuId === 'rm_ch_create_block' ? 'block' : 'none';
  // @ts-ignore
  document.querySelectorAll('#right-nav-panel .right_menu').forEach((menu: HTMLElement) => {
    menu.style.display = 'none';

    if (selectedMenuId && selectedMenuId.replace('#', '') === menu.id) {
      // @ts-ignore
      const mode = displayModes[menu.id] ?? 'block';
      menu.style.display = mode;
      menu.style.opacity = '0.0';
      menu.animate([{ opacity: '0.0' }, { opacity: '1.0' }], {
        duration: animation_duration,
        easing: animation_easing,
        fill: 'forwards',
      });
    }
  });
}

export function isExternalMediaAllowed() {
  const entityId = getCurrentEntityId();
  const resolvedPowerUser = powerUser.get();
  if (!entityId) {
    return !resolvedPowerUser.forbid_external_media;
  }

  if (resolvedPowerUser.external_media_allowed_overrides.includes(entityId)) {
    return true;
  }

  if (resolvedPowerUser.external_media_forbidden_overrides.includes(entityId)) {
    return false;
  }

  return !resolvedPowerUser.forbid_external_media;
}

export function getCurrentEntityId() {
  const resolvedActiveGroupId = activeGroupId.get();
  if (resolvedActiveGroupId) {
    return String(resolvedActiveGroupId);
  }

  const resolvedActiveCharacterIndex = activeCharacterIndex.get();
  const resolvedCharacters = characters.get();
  return resolvedActiveCharacterIndex !== null
    ? (resolvedCharacters[resolvedActiveCharacterIndex]?.avatar ?? null)
    : null;
}

export function setWorldInfoButtonClass(characterIndex: number | null, forceValue: boolean | undefined = undefined) {
  if (forceValue !== undefined) {
    // $('#set_character_world, #world_button').toggleClass('world_set', forceValue);
    document.getElementById('set_character_world')!.classList.toggle('world_set', forceValue);
    document.getElementById('world_button')!.classList.toggle('world_set', forceValue);
    return;
  }

  if (characterIndex === null) {
    return;
  }

  const resolvedCharacters = characters.get();
  const world = resolvedCharacters[characterIndex]?.data?.extensions?.world;
  const worldSet = Boolean(world && worldNames.get().includes(world));
  document.getElementById('set_character_world')!.classList.toggle('world_set', worldSet);
  document.getElementById('world_button')!.classList.toggle('world_set', worldSet);
}

export function checkEmbeddedWorld(characterIndex: number | null = null): boolean {
  // $('#import_character_info').hide();
  document.getElementById('import_character_info')!.style.display = 'none';

  if (characterIndex === null) {
    return false;
  }

  const resolvedCharacters = characters.get();
  if (resolvedCharacters[characterIndex]?.data?.character_book) {
    document.getElementById('import_character_info')!.dataset.chid = String(characterIndex);
    document.getElementById('import_character_info')!.style.display = 'block';

    // Only show the alert once per character
    const checkKey = `AlertWI_${resolvedCharacters[characterIndex].avatar}`;
    const worldName = resolvedCharacters[characterIndex]?.data?.extensions?.world;
    if (!accountStorage.getItem(checkKey) && (!worldName || !worldNames.get().includes(worldName))) {
      accountStorage.setItem(checkKey, 'true');

      if (powerUser.get().world_import_dialog) {
        const html = `<h3>This character has an embedded World/Lorebook.</h3>
                <h3>Would you like to import it now?</h3>
                <div class="m-b-1">If you want to import it later, select "Import Card Lore" in the "More..." dropdown menu on the character panel.</div>`;
        const checkResult = (result: POPUP_RESULT | number | null) => {
          if (result) {
            importEmbeddedWorldInfo(true);
          }
        };
        Popup.confirm('', html, { okButton: 'Yes' }).then(checkResult);
      } else {
        Toast.info(
          'To import and use it, select "Import Card Lore" in the "More..." dropdown menu on the character panel.',
          `${resolvedCharacters[characterIndex].name} has an embedded World/Lorebook`,
          { timeOut: 5000, extendedTimeOut: 10000 },
        );
      }
    }
    return true;
  }

  return false;
}

export async function importEmbeddedWorldInfo(skipPopup = false) {
  const characterIndexStr: string | undefined = document.getElementById('import_character_info')!.dataset.chid;
  const characterIndex = characterIndexStr ? parseInt(characterIndexStr) : undefined;

  if (characterIndex === undefined || characterIndex === -1) {
    return;
  }

  const hasEmbed = checkEmbeddedWorld(characterIndex);
  if (!hasEmbed) {
    return;
  }

  const resolvedCharacters = characters.get();
  const resolvedWorldNames = worldNames.get();
  const bookName =
    resolvedCharacters[characterIndex]?.data?.character_book?.name ||
    `${resolvedCharacters[characterIndex]?.name}'s Lorebook`;

  if (!skipPopup) {
    const confirmation = await Popup.confirm(
      `Are you sure you want to import '${bookName}'?`,
      resolvedWorldNames.includes(bookName) ? `It will overwrite the World/Lorebook with the same name.` : '',
    );
    if (!confirmation) {
      return;
    }
  }

  // const convertedBook = convertCharacterBook(resolvedCharacters[characterIndex].data.character_book); // TODO: Implement

  // await saveWorldInfo(bookName, convertedBook, true); // TODO: Implement
  // await updateWorldInfoList(); // TODO: Implement
  (document.getElementById('character_world') as HTMLInputElement).value = bookName;

  Toast.success(
    `The world '${bookName}' has been imported and linked to the character successfully.`,
    `World/Lorebook imported`,
  );

  const newIndex = resolvedWorldNames.indexOf(bookName);
  if (newIndex >= 0) {
    //show&draw the WI panel before..
    (document.getElementById('WIDrawerIcon') as HTMLElement).click();
    //..auto-opening the new imported WI
    (document.getElementById('world_editor_select') as HTMLSelectElement).value = String(newIndex);
    (document.getElementById('world_editor_select') as HTMLElement).dispatchEvent(new Event('change'));
  }

  setWorldInfoButtonClass(characterIndex, true);
}

/**
 * Updates the state of the favorite button based on the provided state.
 * @param {boolean} state Whether the favorite button should be on or off.
 */
function updateFavButtonState(state: boolean) {
  // Update global state of the flag
  // TODO: This is bad and needs to be refactored.
  favoriteCharacterChecked.set(state);
  document.getElementById('fav_checkbox')!.setAttribute('checked', state ? 'true' : 'false');
  document.getElementById('favorite_button')!.classList.toggle('fav_on', state);
  document.getElementById('favorite_button')!.classList.toggle('fav_off', !state);
}

function getCharacterSource(index: number) {
  const resolvedCharacters = characters.get();
  const character = resolvedCharacters[index];

  if (!character) {
    return '';
  }

  const chubId = resolvedCharacters[index]?.data?.extensions?.chub?.full_path;

  if (chubId) {
    return `https://chub.ai/characters/${chubId}`;
  }

  const pygmalionId = resolvedCharacters[index]?.data?.extensions?.pygmalion_id;

  if (pygmalionId) {
    return `https://pygmalion.chat/${pygmalionId}`;
  }

  const githubRepo = resolvedCharacters[index]?.data?.extensions?.github_repo;

  if (githubRepo) {
    return `https://github.com/${githubRepo}`;
  }

  const sourceUrl = resolvedCharacters[index]?.data?.extensions?.source_url;

  if (sourceUrl) {
    return sourceUrl;
  }

  const risuId = resolvedCharacters[index]?.data?.extensions?.risuai?.source;

  if (Array.isArray(risuId) && risuId.length && typeof risuId[0] === 'string' && risuId[0].startsWith('risurealm:')) {
    const realmId = risuId[0].split(':')[1];
    return `https://realm.risuai.net/character/${realmId}`;
  }

  const perchanceSlug = resolvedCharacters[index]?.data?.extensions?.perchance_data?.slug;

  if (perchanceSlug) {
    return `https://perchance.org/ai-character-chat?data=${perchanceSlug}`;
  }

  return '';
}

async function refreshGroups() {
  try {
    const data = await fetchAllGroups();
    // @ts-ignore
    const sortedGroups = data.sort((a, b) => a.id - b.id);

    const resolvedCharacters = characters.get();
    // Convert groups to new format
    for (const group of sortedGroups) {
      if (typeof group.id === 'number') {
        group.id = String(group.id);
      }
      if (group.disabled_members == undefined) {
        group.disabled_members = [];
      }
      if (group.chat_id == undefined) {
        group.chat_id = group.id;
        group.chats = [group.id];
        group.members = group.members
          .map((x) => resolvedCharacters.find((y) => y.name == x)?.avatar)
          .filter((x): x is string => x !== undefined)
          .filter(onlyUnique);
      }
      if (group.past_metadata == undefined) {
        group.past_metadata = {};
      }
      if (typeof group.chat_id === 'number') {
        group.chat_id = String(group.chat_id);
      }
      if (Array.isArray(group.chats) && group.chats.some((x) => typeof x === 'number')) {
        group.chats = group.chats.map((x) => String(x));
      }
    }
    groups.set(sortedGroups);
  } catch (error) {
    console.error('Failed to refresh groups:', error);
  }
}

/**
 * Prints the global character list, optionally doing a full refresh of the list
 * Use this function whenever the reprinting of the character list is the primary focus, otherwise using `printCharactersDebounced` is preferred for a cleaner, non-blocking experience.
 *
 * The printing will also always reprint all filter options of the global list, to keep them up to date.
 *
 * @param {boolean} fullRefresh - If true, the list is fully refreshed and the navigation is being reset
 */
export async function printCharacters(fullRefresh = false) {
  const storageKey = 'Characters_PerPage';
  const listId = '#rm_print_characters_block';

  // let currentScrollTop = $(listId).scrollTop();
  let currentScrollTop = document.querySelector<HTMLElement>(listId)?.scrollTop || 0;

  if (fullRefresh) {
    saveCharactersPage = 0;
    currentScrollTop = 0;
    await delay(1);
  }

  // Before printing the personas, we check if we should enable/disable search sorting
  // verifyCharactersSearchSortRule(); TODO: Implement

  // We are actually always reprinting filters, as it "doesn't hurt", and this way they are always up to date
  // printTagFilters(tag_filter_type.character); // TODO: Implement
  // printTagFilters(tag_filter_type.group_member); // TODO: Implement

  // We are also always reprinting the lists on character/group edit window, as these ones doesn't get updated otherwise
  // applyTagsOnCharacterSelect(); // TODO: Implement
  // applyTagsOnGroupSelect(); // TODO: Implement

  // const entities = getEntitiesList({ doFilter: true }); // TODO: Port this
  const entities: any[] = []; // Placeholder

  const pageSize = Number(accountStorage.getItem(storageKey)) || 25; // TODO: Replace per_page_default with a constant
  const sizeChangerOptions = [10, 25, 50, 100, 250, 500, 1000];
  // $('#rm_print_characters_pagination').pagination({ // TODO: Port pagination
  //   dataSource: entities,
  //   pageSize,
  //   pageRange: 1,
  //   pageNumber: saveCharactersPage || 1,
  //   position: 'top',
  //   showPageNumbers: false,
  //   showSizeChanger: true,
  //   prevText: '<',
  //   nextText: '>',
  //   formatNavigator: PAGINATION_TEMPLATE,
  //   formatSizeChanger: renderPaginationDropdown(pageSize, sizeChangerOptions),
  //   showNavigator: true,
  //   callback: async function (/** @type {Entity[]} */ data) {
  //     $(listId).empty();
  //     if (powerUser.get().bogus_folders && isBogusFolderOpen()) {
  //       $(listId).append(getBackBlock());
  //     }
  //     if (!data.length) {
  //       const emptyBlock = await getEmptyBlock();
  //       $(listId).append(emptyBlock);
  //     }
  //     let displayCount = 0;
  //     for (const i of data) {
  //       switch (i.type) {
  //         case 'character':
  //           $(listId).append(getCharacterBlock(i.item, i.id));
  //           displayCount++;
  //           break;
  //         case 'group':
  //           $(listId).append(getGroupBlock(i.item));
  //           displayCount++;
  //           break;
  //         case 'tag':
  //           $(listId).append(getTagBlock(i.item, i.entities, i.hidden, i.isUseless));
  //           break;
  //       }
  //     }

  //     const hidden = characters.length + groups.length - displayCount;
  //     if (hidden > 0 && entitiesFilter.hasAnyFilter()) {
  //       const hiddenBlock = await getHiddenBlock(hidden);
  //       $(listId).append(hiddenBlock);
  //     }
  //     localizePagination($('#rm_print_characters_pagination'));

  //     // eventSource.emit(event_types.CHARACTER_PAGE_LOADED); // TODO: Implement
  //   },
  //   afterSizeSelectorChange: function (e, size) {
  //     accountStorage.setItem(storageKey, e.target.value);
  //     paginationDropdownChangeHandler(e, size);
  //   },
  //   afterPaging: function (e) {
  //     saveCharactersPage = e;
  //   },
  //   afterRender: function () {
  //     $(listId).scrollTop(currentScrollTop);
  //   },
  // });

  // favsToHotswap(); // TODO: Implement
  // updatePersonaConnectionsAvatarList(); // TODO: Implement
}
