import Bowser from 'bowser';

/**
 * Checks if the device is a mobile device.
 * @returns {boolean} - True if the device is a mobile device, false otherwise.
 */
export function isMobile() {
  const mobileTypes = ['mobile', 'tablet'];

  const result = getParsedUA();
  if (!result || !result.platform || !result.platform.type) {
    return false;
  }
  return mobileTypes.includes(result.platform.type);
}

let parsedUA: Bowser.Parser.ParsedResult | null = null;

export function getParsedUA() {
  if (!parsedUA) {
    try {
      parsedUA = Bowser.parse(navigator.userAgent);
    } catch {
      // In case the user agent is an empty string or Bowser can't parse it for some other reason
    }
  }

  return parsedUA;
}
