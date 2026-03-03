import type { Ref } from "vue";

/** Helper function to add additional constraints to an input element.
 * @param inputRef - The ref to the input element.
 * @param validator - Validates and returns a validity message for invalid values.
 * @returns A function that can be used to validate the input element.
 */
export function additionalConstraint<T>(
    inputRef: Ref<HTMLInputElement | null>,
    validator: (value: T) => { valid: false, message: string } | { valid: true, message?: ''},
  ): (newValue: T) => void {
    return function (newValue: T) {
      const inputElement = inputRef.value;
      if (!inputElement) {
        return;
      }
      if (!inputElement.validity.valid) {
        /* Reset custom validity to see if it passes the native validation. */
        inputElement.setCustomValidity('');
        inputElement.checkValidity();
        if (!inputElement.validity.valid) {
          return;
        }
      }
      const result = validator(newValue);
      if (!result.valid) {
        inputElement.setCustomValidity(result.message);
      }
    };
  }
