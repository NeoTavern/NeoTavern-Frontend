import { computed, ref } from 'vue';
import { uploadFile, uploadMedia } from '../api/media';
import { useModelCapabilities } from '../composables/useModelCapabilities';
import { useStrictI18n } from '../composables/useStrictI18n';
import { toast } from '../composables/useToast';
import { useCharacterStore } from '../stores/character.store';
import { useSettingsStore } from '../stores/settings.store';
import { type ChatMediaItem } from '../types';
import { base64EncodeUTF8, getBase64Async } from '../utils/commons';
import { getMediaDurationFromDataURL } from '../utils/media';

export function useChatMedia() {
  const characterStore = useCharacterStore();
  const settingsStore = useSettingsStore();
  const { hasCapability } = useModelCapabilities();
  const { t } = useStrictI18n();

  const attachedMedia = ref<ChatMediaItem[]>([]);
  const isUploading = ref(false);
  const fileInput = ref<HTMLInputElement | null>(null);

  const acceptedFileTypes = computed(() => {
    const types = [];
    if (hasCapability('vision')) types.push('image/*');
    if (hasCapability('video')) types.push('video/*');
    if (hasCapability('audio')) types.push('audio/*');
    types.push('text/*', '.md', '.json', '.txt', '.csv');
    return types.join(', ');
  });

  const isMediaAttachDisabled = computed(() => {
    return isUploading.value || !acceptedFileTypes.value;
  });

  const mediaAttachTitle = computed(() => {
    if (!acceptedFileTypes.value) {
      return t('chat.media.notSupported');
    }
    return t('chat.media.attach');
  });

  async function processFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const provider = settingsStore.settings.api.provider;
    const isGoogle = provider === 'makersuite' || provider === 'vertexai';

    isUploading.value = true;
    try {
      for (const file of Array.from(files)) {
        let mediaType: 'image' | 'video' | 'audio' | 'text' | null = null;
        let sizeLimit = 5 * 1024 * 1024; // 5MB default for images

        if (file.type.startsWith('image/')) {
          if (!hasCapability('vision')) {
            toast.warning(t('chat.media.unsupportedVision'));
            continue;
          }
          mediaType = 'image';
        } else if (file.type.startsWith('video/')) {
          if (!hasCapability('video')) {
            toast.warning(t('chat.media.unsupportedVideo'));
            continue;
          }
          mediaType = 'video';
          sizeLimit = 20 * 1024 * 1024; // 20MB for video
        } else if (file.type.startsWith('audio/')) {
          if (!hasCapability('audio')) {
            toast.warning(t('chat.media.unsupportedAudio'));
            continue;
          }
          mediaType = 'audio';
          sizeLimit = 20 * 1024 * 1024; // 20MB for audio
        } else if (
          file.type.startsWith('text/') ||
          file.type === 'application/json' ||
          file.name.toLowerCase().endsWith('.md') ||
          file.name.toLowerCase().endsWith('.txt') ||
          file.name.toLowerCase().endsWith('.csv')
        ) {
          mediaType = 'text';
          sizeLimit = 10 * 1024 * 1024; // 10MB for text
        }

        if (!mediaType) {
          toast.warning(t('chat.media.unsupportedType', { type: file.type }));
          continue;
        }

        if (file.size > sizeLimit) {
          toast.warning(t('chat.media.tooLarge', { name: file.name }));
          continue;
        }

        // Duration checks
        if (isGoogle && mediaType === 'video') {
          try {
            const duration = await getMediaDurationFromDataURL(await getBase64Async(file), 'video');
            if (duration > 60) {
              toast.warning(t('chat.media.videoTooLong', { name: file.name }));
              continue;
            }
          } catch (e) {
            console.error('Failed to get video duration:', e);
            toast.error(t('chat.media.metadataError'));
            continue;
          }
        }

        let base64: string;
        const format = file.type.split('/')[1] || 'bin';
        if (mediaType === 'text') {
          const text = await file.text();
          base64 = base64EncodeUTF8(text);
        } else {
          base64 = await getBase64Async(file);
        }

        let response: { path: string };
        if (mediaType === 'text') {
          response = await uploadFile({
            name: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${format}`,
            data: base64,
          });
        } else {
          response = await uploadMedia({
            ch_name: characterStore.activeCharacters?.[0]?.name,
            filename: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            format: file.type.split('/')[1] || 'bin',
            image: base64.split(',')[1],
          });
        }

        attachedMedia.value.push({
          source: 'upload',
          type: mediaType,
          url: response.path,
          title: file.name,
        });
      }
    } catch (error) {
      console.error('Error uploading media:', error);
      toast.error(error instanceof Error ? error.message : t('chat.media.uploadError'));
    } finally {
      isUploading.value = false;
    }
  }

  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    await processFiles(input.files);
    // Reset file input to allow selecting the same file again
    if (input) input.value = '';
  }

  function handlePaste(event: ClipboardEvent) {
    processFiles(event.clipboardData?.files ?? null);
  }

  function triggerFileUpload() {
    fileInput.value?.click();
  }

  function removeAttachedMedia(index: number) {
    attachedMedia.value.splice(index, 1);
  }

  return {
    attachedMedia,
    isUploading,
    fileInput,
    acceptedFileTypes,
    isMediaAttachDisabled,
    mediaAttachTitle,
    processFiles,
    handleFileSelect,
    handlePaste,
    triggerFileUpload,
    removeAttachedMedia,
  };
}
