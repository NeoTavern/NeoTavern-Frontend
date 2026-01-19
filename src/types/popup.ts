import type { Component } from 'vue';
import type { I18nKey } from './i18n';

export enum POPUP_TYPE {
  TEXT = 1,
  CONFIRM = 2,
  INPUT = 3,
  DISPLAY = 4,
  CROP = 5,
  SELECT = 6,
}

export enum POPUP_RESULT {
  AFFIRMATIVE = 1,
  NEGATIVE = 0,
  CANCELLED = -1,
}

export interface CustomPopupButton {
  text: string;
  result: number;
  classes?: string[] | string;
  isDefault?: boolean;
}

export interface PopupOptions {
  okButton?: I18nKey | boolean;
  cancelButton?: I18nKey | boolean;
  rows?: number;
  wide?: boolean;
  large?: boolean;
  customButtons?: CustomPopupButton[];
  defaultResult?: number;
  cropImage?: string;
  component?: Component;
  selectOptions?: { label: string; value: string }[];
  selectValue?: string | string[];
  selectMultiple?: boolean;
  // TODO: Is there way to make type-safe...?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentProps?: Record<string, any>;
}
export interface PopupState extends PopupOptions {
  id: string;
  visible: boolean;
  title: string;
  content: string;
  type: POPUP_TYPE;
  inputValue?: string;
  selectValue?: string | string[];
}

export type PopupShowOptions = Partial<Omit<PopupState, 'id' | 'visible'>>;
