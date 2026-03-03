// @vitest-environment jsdom
import { it as baseIt, describe, expect } from 'vitest';
import type { Ref } from 'vue';
import { additionalConstraint } from '../form-help';

function makeRef(el: HTMLInputElement | null): Ref<HTMLInputElement | null> {
  return { value: el } as Ref<HTMLInputElement | null>;
}

const it = baseIt.extend<{
  input: HTMLInputElement;
  ref: Ref<HTMLInputElement | null>;
}>({
  input: async ({}, use) => {
    const input = document.createElement('input');
    await use(input);
  },
  ref: async ({ input }, use) => {
    await use(makeRef(input));
  },
});

describe('additionalConstraint', () => {
  // Where both input state and validate() are used, we pass Number(input.value)
  // so the value validated is explicitly tied to the input's state.

  it('does nothing when inputRef.value is null', () => {
    const ref = makeRef(null);
    const validator = () => ({ valid: false as const, message: 'err' });
    const validate = additionalConstraint(ref, validator);
    expect(() => validate(1)).not.toThrow();
  });

  it('does not call validator when input is natively invalid', ({ input, ref }) => {
    input.required = true;
    input.value = '';
    let validatorCalled = false;
    const validator = () => {
      validatorCalled = true;
      return { valid: true as const };
    };
    expect(input.validity.valid).toBe(false);
    const validate = additionalConstraint(ref, validator);
    validate(Number(input.value)); // value derived from input: empty -> NaN
    expect(input.validity.valid).toBe(false);
    expect(validatorCalled).toBe(false);
  });

  it('sets custom validity when input is valid and validator returns invalid', ({ input, ref }) => {
    input.required = true;
    input.value = '-1';
    expect(input.validity.valid).toBe(true);
    const validationMessage = 'Must be positive';
    const validate = additionalConstraint(ref, () => ({
      valid: false as const,
      message: validationMessage,
    }));
    validate(Number(input.value));
    expect(input.validity.valid).toBe(false);
    expect(input.validationMessage).toBe(validationMessage);
  });

  it('does not set custom validity when input is valid and validator returns valid', ({ input, ref }) => {
    input.value = '1';
    const validate = additionalConstraint(ref, () => ({ valid: true as const }));
    validate(Number(input.value));
    expect(input.validity.valid).toBe(true);
    expect(input.validationMessage).toBe('');
  });

  it('allows native invalidation for revised value that passes custom validation', ({ input, ref }) => {
    input.type = 'number';
    input.setAttribute('min', '3');
    input.value = '3';
    expect(input.validity.valid).toBe(true);
    const validationMessage = 'Must be even';
    const validate = additionalConstraint(ref, (value: number) =>
      value % 2 !== 0 ? { valid: false as const, message: validationMessage } : { valid: true as const },
    );
    validate(Number(input.value));
    expect(input.validity.valid).toBe(false);
    expect(input.validationMessage).toBe(validationMessage);

    // Odd number was invalidated by our custom validator. Now we set an even number that is below
    // the native min attribute.
    input.value = '2';
    validate(Number(input.value));
    expect(input.validity.valid).toBe(false);
    expect(input.validity.rangeUnderflow).toBe(true);
    expect(input.validationMessage).not.toBe(validationMessage);
  });
});
