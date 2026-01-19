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

  function show<T = unknown>(options: PopupShowOptions): Promise<{ result: number; value: T; closePopup: () => void }> {
    const id = uuidv4();
    const newPopup: PopupState = {
      id,
      visible: true,
      title: '',
      content: '',
      type: POPUP_TYPE.TEXT,
      inputValue: '',
      selectValue: options.selectMultiple ? [] : '',
      ...options,
    };

    popups.value.push(newPopup);

    const closePopup = () => cancel(id);

    if (newPopup.component) {
      if (!newPopup.componentProps) {
        newPopup.componentProps = {};
      }
      newPopup.componentProps.closePopup = closePopup;
    }

    return new Promise((resolve) => {
      popupPromises.set(id, {
        resolve: (payload) => resolve({ ...payload, closePopup }),
        reject: () => resolve({ result: POPUP_RESULT.CANCELLED, value: null as T, closePopup }),
      });
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
