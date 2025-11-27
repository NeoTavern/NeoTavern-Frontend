import { defineStore } from 'pinia';
import { ref } from 'vue';
import { POPUP_RESULT, POPUP_TYPE, type PopupShowOptions, type PopupState } from '../types';
import { uuidv4 } from '../utils/commons';

interface PopupPromise<T = unknown> {
  resolve: (payload: { result: number; value: T }) => void;
  reject: (reason?: unknown) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const popupPromises = new Map<string, PopupPromise<any>>();

export const usePopupStore = defineStore('popup', () => {
  const popups = ref<PopupState[]>([]);

  function show<T = unknown>(options: PopupShowOptions): Promise<{ result: number; value: T }> {
    const id = uuidv4();
    const newPopup: PopupState = {
      id,
      visible: true,
      title: '',
      content: '',
      type: POPUP_TYPE.TEXT,
      inputValue: '',
      ...options,
    };

    popups.value.push(newPopup);

    return new Promise((resolve, reject) => {
      popupPromises.set(id, { resolve, reject });
    });
  }

  function hide(id: string) {
    const index = popups.value.findIndex((p) => p.id === id);
    if (index > -1) {
      popups.value.splice(index, 1);
    }
    popupPromises.delete(id);
  }

  function confirm<T = unknown>(id: string, payload: { result: number; value: T }) {
    const promise = popupPromises.get(id);
    if (promise) {
      promise.resolve(payload);
    }
    hide(id);
  }

  function cancel(id: string) {
    const promise = popupPromises.get(id);
    if (promise) {
      promise.resolve({ result: POPUP_RESULT.CANCELLED, value: null });
    }
    hide(id);
  }

  return {
    popups,
    show,
    confirm,
    cancel,
  };
});
