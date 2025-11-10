import Cropper, { CropperImage, CropperSelection } from 'cropperjs';
import { shouldSendOnEnter } from '../stores/settings.store';
import { removeFromArray } from '../utils/array';
import { runAfterAnimation } from '../utils/dom';
import { uuidv4 } from '../utils/common';

// Note for developer: The 'fixToastrForDialogs' function was removed.
// It was a fragile hack that moved the toastr container around the DOM.
// The correct, robust solution is to handle this with CSS. Ensure your
// toast container has a z-index higher than the dialog and its backdrop.
// Example CSS:
// .popup::backdrop { z-index: 1050; }
// #toast-container { z-index: 1060; }

export enum POPUP_TYPE {
  /** Main popup type. Containing any content displayed, with buttons below. Can also contain additional input controls. */
  TEXT = 1,
  /** Popup mainly made to confirm something, answering with a simple Yes/No or similar. Focus on the button controls. */
  CONFIRM = 2,
  /** Popup who's main focus is the input text field, which is displayed here. Can contain additional content above. Return value for this is the input string. */
  INPUT = 3,
  /** Popup without any button controls. Used to simply display content, with a small X in the corner. */
  DISPLAY = 4,
  /** Popup that displays an image to crop. Returns a cropped image in result. */
  CROP = 5,
}

export enum POPUP_RESULT {
  AFFIRMATIVE = 1,
  NEGATIVE = 0,
  CANCELLED = -1, // Using a distinct number to avoid confusion with null/undefined in type checks
  CUSTOM1 = 1001,
  CUSTOM2 = 1002,
  CUSTOM3 = 1003,
  CUSTOM4 = 1004,
  CUSTOM5 = 1005,
  CUSTOM6 = 1006,
  CUSTOM7 = 1007,
  CUSTOM8 = 1008,
  CUSTOM9 = 1009,
}

export interface CustomPopupButton {
  text: string;
  result?: POPUP_RESULT | number;
  classes?: string[] | string;
  action?: () => void;
  appendAtEnd?: boolean;
}

export interface CustomPopupInput {
  id: string;
  label: string;
  tooltip?: string;
  defaultState?: boolean | string;
  type?: 'checkbox' | 'text';
}

export interface PopupOptions {
  okButton?: string | boolean;
  cancelButton?: string | boolean;
  rows?: number;
  wide?: boolean;
  wider?: boolean;
  large?: boolean;
  transparent?: boolean;
  allowHorizontalScrolling?: boolean;
  allowVerticalScrolling?: boolean;
  leftAlign?: boolean;
  animation?: 'slow' | 'fast' | 'none';
  defaultResult?: POPUP_RESULT | number;
  customButtons?: (CustomPopupButton | string)[];
  customInputs?: CustomPopupInput[];
  onClosing?: (popup: Popup) => Promise<boolean | undefined> | boolean | undefined;
  onClose?: (popup: Popup) => Promise<void> | void;
  onOpen?: (popup: Popup) => Promise<void> | void;
  cropAspect?: number;
  cropImage?: string;
}

export interface PopupShowResult {
  value: any;
  result: POPUP_RESULT | number;
  inputResults?: Map<string, string | boolean>;
}

export class Popup {
  public readonly id: string;
  public readonly type: POPUP_TYPE;

  // DOM Elements
  public readonly dlg: HTMLDialogElement;
  // @ts-ignore
  private readonly body: HTMLDivElement;
  // @ts-ignore
  private readonly content: HTMLDivElement;
  // @ts-ignore
  public readonly mainInput: HTMLTextAreaElement;
  // @ts-ignore
  private readonly inputControls: HTMLDivElement;
  // @ts-ignore
  private readonly buttonControls: HTMLDivElement;
  // @ts-ignore
  private readonly okButton: HTMLButtonElement;
  // @ts-ignore
  private readonly cancelButton: HTMLButtonElement;
  // @ts-ignore
  private readonly closeButton: HTMLButtonElement;
  // @ts-ignore
  private readonly cropWrap: HTMLDivElement;
  // @ts-ignore
  private readonly cropImage: HTMLImageElement;
  // @ts-ignore

  // Configuration
  private readonly defaultResult: POPUP_RESULT | number;
  private readonly customInputs?: CustomPopupInput[];
  private readonly onClosing?: (popup: Popup) => Promise<boolean | undefined> | boolean | undefined;
  private readonly onClose?: (popup: Popup) => Promise<void> | void;
  private readonly onOpen?: (popup: Popup) => Promise<void> | void;

  // State
  public result?: POPUP_RESULT | number;
  public value?: any;
  public inputResults?: Map<string, string | boolean>;
  private cropper?: Cropper;
  private lastFocus?: HTMLElement;

  #promise!: Promise<PopupShowResult | null>;
  #resolver!: (result: PopupShowResult | null) => void;
  #isClosingPrevented = false;

  constructor(content: string | Element, type: POPUP_TYPE, inputValue = '', options: PopupOptions = {}) {
    this.id = uuidv4();
    this.type = type;
    Popup._popups.push(this);

    this.onClosing = options.onClosing;
    this.onClose = options.onClose;
    this.onOpen = options.onOpen;
    this.defaultResult = options.defaultResult ?? POPUP_RESULT.AFFIRMATIVE;
    this.customInputs = options.customInputs;

    const template = document.querySelector<HTMLTemplateElement>('#popup-template');
    if (!template) throw new Error('Popup template not found in DOM.');
    this.dlg = (template.content.cloneNode(true) as DocumentFragment).querySelector('.popup') as HTMLDialogElement;

    this._initializeDom();
    this._buildUi(content, inputValue, options);
    this._bindEventListeners();

    // Prepare auto-focus for when the dialog is shown
    this.setAutoFocus({ applyAsAttribute: true });
  }

  private _initializeDom(): void {
    // @ts-ignore
    this.body = this.dlg.querySelector('.popup-body') as HTMLDivElement;
    // @ts-ignore
    this.content = this.dlg.querySelector('.popup-content') as HTMLDivElement;
    // @ts-ignore
    this.mainInput = this.dlg.querySelector('.popup-input') as HTMLTextAreaElement;
    // @ts-ignore
    this.inputControls = this.dlg.querySelector('.popup-inputs') as HTMLDivElement;
    // @ts-ignore
    this.buttonControls = this.dlg.querySelector('.popup-controls') as HTMLDivElement;
    // @ts-ignore
    this.okButton = this.dlg.querySelector('.popup-button-ok') as HTMLButtonElement;
    // @ts-ignore
    this.cancelButton = this.dlg.querySelector('.popup-button-cancel') as HTMLButtonElement;
    // @ts-ignore
    this.closeButton = this.dlg.querySelector('.popup-button-close') as HTMLButtonElement;
    // @ts-ignore
    this.cropWrap = this.dlg.querySelector('.popup-crop-wrap') as HTMLDivElement;
    // @ts-ignore
    this.cropImage = this.dlg.querySelector('.popup-crop-image') as HTMLImageElement;
  }

  private _buildUi(popupContent: string | Element, inputValue: string, options: PopupOptions): void {
    const {
      okButton = null,
      cancelButton = null,
      rows = 1,
      wide = false,
      wider = false,
      large = false,
      transparent = false,
      allowHorizontalScrolling = false,
      allowVerticalScrolling = false,
      leftAlign = false,
      animation = 'fast',
      customButtons = null,
      customInputs = null,
      cropAspect = null,
      cropImage = '',
    } = options;

    this.dlg.setAttribute('data-id', this.id);
    this.dlg.classList.toggle('popup--wide', wide);
    this.dlg.classList.toggle('popup--wider', wider);
    this.dlg.classList.toggle('popup--large', large);
    this.dlg.classList.toggle('popup--transparent', transparent);
    this.dlg.classList.toggle('popup--h-scroll', allowHorizontalScrolling);
    this.dlg.classList.toggle('popup--v-scroll', allowVerticalScrolling);
    this.dlg.classList.toggle('popup--left-align', leftAlign);
    if (animation !== 'none') {
      this.dlg.classList.add(`popup--animation-${animation}`);
    }

    if (typeof popupContent === 'string') {
      this.content.innerHTML = popupContent;
    } else {
      this.content.append(popupContent);
    }

    // Create custom controls
    this._createCustomButtons(customButtons);
    this._createCustomInputs(customInputs);

    // Apply type-specific styles and logic
    this.dlg.classList.add(`popup--type-${POPUP_TYPE[this.type].toLowerCase()}`);
    const template = document.querySelector<HTMLTemplateElement>('#popup-template');

    switch (this.type) {
      case POPUP_TYPE.TEXT:
        this.okButton.style.display = okButton === false ? 'none' : '';
        this.cancelButton.style.display = !cancelButton ? 'none' : '';
        break;
      case POPUP_TYPE.CONFIRM:
        this.okButton.style.display = okButton === false ? 'none' : '';
        this.cancelButton.style.display = cancelButton === false ? 'none' : '';
        if (!okButton) this.okButton.textContent = template?.getAttribute('popup-button-yes') ?? 'Yes';
        if (!cancelButton) this.cancelButton.textContent = template?.getAttribute('popup-button-no') ?? 'No';
        break;
      case POPUP_TYPE.INPUT:
        this.mainInput.value = inputValue;
        this.mainInput.rows = rows ?? 1;
        this.okButton.style.display = okButton === false ? 'none' : '';
        this.cancelButton.style.display = cancelButton === false ? 'none' : '';
        if (!okButton) this.okButton.textContent = template?.getAttribute('popup-button-save') ?? 'Save';
        break;
      case POPUP_TYPE.CROP:
        this.cropImage.src = cropImage;
        this.cropper = new Cropper(this.cropImage);
        const selection = this.cropper.getCropperSelection() as CropperSelection;
        const image = this.cropper.getCropperImage() as CropperImage;
        selection.aspectRatio = cropAspect ?? 2 / 3;
        selection.initialCoverage = 1;
        // selection.$change( // TODO: fix viewMode
        image.rotatable = false;
        this.okButton.style.display = okButton === false ? 'none' : '';
        this.cancelButton.style.display = cancelButton === false ? 'none' : '';
        if (!okButton) this.okButton.textContent = template?.getAttribute('popup-button-crop') ?? 'Crop';
        break;
    }

    if (typeof okButton === 'string') this.okButton.textContent = okButton;
    if (typeof cancelButton === 'string') this.cancelButton.textContent = cancelButton;

    const defaultButton = this.buttonControls.querySelector<HTMLElement>(`[data-result="${this.defaultResult}"]`);
    if (defaultButton) defaultButton.classList.add('menu_button_default');
  }

  private _createCustomButtons(buttons: (CustomPopupButton | string)[] | null): void {
    if (!buttons) return;

    buttons.forEach((b, index) => {
      const button: CustomPopupButton = typeof b === 'string' ? { text: b, result: index + 2 } : b;

      const el = document.createElement('button');
      el.classList.add('menu_button', 'popup-button-custom', 'result-control');
      if (button.classes) {
        const classes = Array.isArray(button.classes) ? button.classes : [button.classes];
        el.classList.add(...classes);
      }
      el.dataset.result = String(button.result ?? 'undefined');
      el.textContent = button.text;
      el.tabIndex = 0;

      if (button.appendAtEnd) {
        this.buttonControls.appendChild(el);
      } else {
        this.buttonControls.insertBefore(el, this.okButton);
      }

      if (typeof button.action === 'function') {
        el.addEventListener('click', button.action);
      }
    });
  }

  private _createCustomInputs(inputs: CustomPopupInput[] | null): void {
    if (!inputs) return;

    this.inputControls.style.display = 'block';

    inputs.forEach((input) => {
      if (!input.id || typeof input.id !== 'string') {
        console.warn('Given custom input does not have a valid id set');
        return;
      }

      const type = input.type ?? 'checkbox';
      if (type === 'checkbox') {
        const label = document.createElement('label');
        label.classList.add('checkbox_label', 'justifyCenter');
        label.htmlFor = input.id;

        const inputEl = document.createElement('input');
        inputEl.type = 'checkbox';
        inputEl.id = input.id;
        inputEl.checked = Boolean(input.defaultState ?? false);
        label.appendChild(inputEl);

        const labelText = document.createElement('span');
        labelText.innerText = input.label;
        label.appendChild(labelText);

        if (input.tooltip) {
          const tooltip = document.createElement('div');
          tooltip.classList.add('fa-solid', 'fa-circle-info', 'opacity50p');
          tooltip.title = input.tooltip;
          label.appendChild(tooltip);
        }
        this.inputControls.appendChild(label);
      } else if (type === 'text') {
        const label = document.createElement('label');
        label.classList.add('text_label', 'justifyCenter');
        label.htmlFor = input.id;

        const inputEl = document.createElement('input');
        inputEl.classList.add('text_pole', 'result-control');
        inputEl.type = 'text';
        inputEl.id = input.id;
        inputEl.value = String(input.defaultState ?? '');
        inputEl.placeholder = input.tooltip ?? '';

        const labelText = document.createElement('span');
        labelText.innerText = input.label;

        label.appendChild(labelText);
        label.appendChild(inputEl);
        this.inputControls.appendChild(label);
      } else {
        console.warn('Unknown custom input type. Only checkbox and text are supported.', input);
      }
    });
  }

  private _bindEventListeners(): void {
    this.dlg.addEventListener('focusin', (evt) => {
      if (evt.target instanceof HTMLElement && evt.target !== this.dlg) {
        this.lastFocus = evt.target;
      }
    });

    this.dlg.querySelectorAll<HTMLElement>('[data-result]').forEach((control) => {
      const resultStr = control.dataset.result;
      if (resultStr === 'undefined') return;

      const result = resultStr === String(POPUP_RESULT.CANCELLED) ? POPUP_RESULT.CANCELLED : Number(resultStr);
      if (isNaN(result)) throw new Error(`Invalid result control. Result must be a number: ${resultStr}`);

      const eventType = (control.dataset.resultEvent as keyof HTMLElementEventMap) || 'click';
      control.addEventListener(eventType, () => this.complete(result));
    });

    this.dlg.addEventListener('cancel', (evt) => {
      evt.preventDefault();
      this.complete(POPUP_RESULT.CANCELLED);
    });

    // This listener prevents the dialog from closing via its native mechanism
    // if our custom onClosing handler decided to cancel the close.
    this.dlg.addEventListener('close', (evt) => {
      if (this.#isClosingPrevented) {
        evt.preventDefault();
        this.#isClosingPrevented = false; // Reset for next attempt
        this.dlg.showModal(); // Re-open immediately
      }
    });

    this.dlg.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || evt.altKey || evt.shiftKey) return;

      if (this.dlg !== document.activeElement?.closest('.popup')) return;

      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.closest('.result-control')) return;

      const isTextArea = activeEl.tagName === 'TEXTAREA';
      const isTextInput = activeEl.tagName === 'INPUT' && (activeEl as HTMLInputElement).type === 'text';
      if ((isTextArea || isTextInput) && !shouldSendOnEnter()) {
        return;
      }

      evt.preventDefault();
      evt.stopPropagation();
      const result = Number(activeEl.getAttribute('data-result') ?? this.defaultResult);
      this.complete(result);
    });
  }

  public async show(): Promise<PopupShowResult | null> {
    document.body.append(this.dlg);
    this.dlg.showModal();

    this.dlg.setAttribute('opening', '');
    runAfterAnimation(this.dlg, () => {
      this.dlg.removeAttribute('opening');
      this.onOpen?.(this);
    });

    this.#promise = new Promise((resolve) => {
      this.#resolver = resolve;
    });
    return this.#promise;
  }

  public setAutoFocus({ applyAsAttribute = false } = {}): void {
    let control = this.dlg.querySelector<HTMLElement>('[autofocus]');
    if (!control) {
      control =
        this.type === POPUP_TYPE.INPUT
          ? this.mainInput
          : this.buttonControls.querySelector<HTMLElement>(`[data-result="${this.defaultResult}"]`);
    }

    if (control) {
      if (applyAsAttribute) {
        control.setAttribute('autofocus', '');
        control.tabIndex = 0;
      } else {
        control.focus();
      }
    }
  }

  public async complete(result: POPUP_RESULT | number): Promise<void> {
    let value: any = result;
    if (this.type === POPUP_TYPE.INPUT) {
      value = result >= POPUP_RESULT.AFFIRMATIVE ? this.mainInput.value : null;
    } else if (this.type === POPUP_TYPE.CROP) {
      value =
        result >= POPUP_RESULT.AFFIRMATIVE && this.cropper
          ? (await this.cropper.getCropperCanvas()?.$toCanvas())?.toDataURL('image/png')
          : null;
    }

    if (result === POPUP_RESULT.CANCELLED) {
      value = null;
    }

    this.value = value;
    this.result = result;
    if (this.customInputs?.length) {
      this.inputResults = new Map(
        this.customInputs.map((input) => {
          const el = this.dlg.querySelector<HTMLInputElement>(`#${input.id}`);
          const val = el?.type === 'checkbox' ? el.checked : el?.value;
          return [input.id, val as string | boolean];
        }),
      );
    }

    const shouldClose = await this.onClosing?.(this);
    if (shouldClose === false) {
      this.#isClosingPrevented = true;
      this.value = undefined;
      this.result = undefined;
      this.inputResults = undefined;
      return;
    }

    this.#hide();
  }

  public async completeAffirmative(): Promise<void> {
    return this.complete(POPUP_RESULT.AFFIRMATIVE);
  }
  public async completeNegative(): Promise<void> {
    return this.complete(POPUP_RESULT.NEGATIVE);
  }
  public async completeCancelled(): Promise<void> {
    return this.complete(POPUP_RESULT.CANCELLED);
  }

  #hide(): void {
    this.dlg.setAttribute('closing', '');

    runAfterAnimation(this.dlg, async () => {
      await this.onClose?.(this);
      this.dlg.close();
      this.dlg.remove();
      removeFromArray(Popup._popups, this);

      // Restore focus to the next popup down, if any
      const topPopup = Popup.getTopmostPopup();
      topPopup?.lastFocus?.focus();

      if (this.result === POPUP_RESULT.CANCELLED) {
        this.#resolver(null);
      } else {
        this.#resolver({
          value: this.value,
          result: this.result!,
          inputResults: this.inputResults,
        });
      }
    });
  }

  // Static helper methods for common use cases
  public static async input(
    header: string,
    text?: string,
    defaultValue = '',
    options: PopupOptions = {},
  ): Promise<string | null> {
    const content = Popup._buildTextWithHeader(header, text);
    const popup = new Popup(content, POPUP_TYPE.INPUT, defaultValue, options);
    const result = await popup.show();
    return result?.value ?? null;
  }

  public static async confirm(
    header: string,
    text?: string,
    options: PopupOptions = {},
  ): Promise<POPUP_RESULT | number | null> {
    const content = Popup._buildTextWithHeader(header, text);
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', options);
    const result = await popup.show();
    return result?.result ?? null;
  }

  public static async text(
    header: string,
    text: string,
    options: PopupOptions = {},
  ): Promise<POPUP_RESULT | number | null> {
    const content = Popup._buildTextWithHeader(header, text);
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', options);
    const result = await popup.show();
    return result?.result ?? null;
  }

  private static _buildTextWithHeader(header: string, text?: string): string {
    if (!header) return text ?? '';
    return `<h3>${header}</h3>${text ?? ''}`;
  }

  // Static utilities for managing popups
  private static readonly _popups: Popup[] = [];

  public static get openPopups(): readonly Popup[] {
    return this._popups;
  }

  public static isPopupOpen(): boolean {
    return this._popups.some((p) => p.dlg.hasAttribute('open'));
  }

  public static getTopmostPopup(): Popup | undefined {
    return this._popups[this._popups.length - 1];
  }

  public static getTopmostModalLayer(): HTMLElement {
    const openDialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]:not([closing])'));
    return openDialogs.pop() ?? document.body;
  }
}

/**
 * @deprecated Use the static methods on the Popup class instead, like `Popup.input(...)`
 */
export function callGenericPopup(
  content: string | Element,
  type: POPUP_TYPE,
  inputValue = '',
  popupOptions: PopupOptions = {},
): Promise<PopupShowResult | null> {
  const popup = new Popup(content, type, inputValue, popupOptions);
  return popup.show();
}

export function getTopmostModalLayer(): HTMLElement {
  return Popup.getTopmostModalLayer();
}
