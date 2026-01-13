/**
 * Checks if a string is a valid Data URL.
 * @param s String to check
 */
export function isDataURL(s: string): boolean {
  return /^\s*data:([a-z]+\/[a-z0-9-+.]+(;[a-z-]+=[a-z0-9-]+)?)?(;base64)?,([a-z0-9!$&',()*+;=\-._~:@/?%\s]*?)\s*$/i.test(
    s,
  );
}

/**
 * Calculates the thumbnail size for a media element while maintaining aspect ratio.
 */
export function calculateThumbnailSize(
  width: number,
  height: number,
  maxWidth: number | null,
  maxHeight: number | null,
): { thumbnailWidth: number; thumbnailHeight: number } {
  const aspectRatio = width / height;
  let thumbnailWidth = maxWidth as number;
  let thumbnailHeight = maxHeight as number;

  if (maxWidth === null) {
    thumbnailWidth = width;
    maxWidth = width;
  }

  if (maxHeight === null) {
    thumbnailHeight = height;
    maxHeight = height;
  }

  if (width <= maxWidth && height <= maxHeight) {
    thumbnailWidth = width;
    thumbnailHeight = height;
  } else {
    if (width > height) {
      thumbnailHeight = maxWidth / aspectRatio;
    } else {
      thumbnailWidth = maxHeight * aspectRatio;
    }
  }

  return { thumbnailWidth: Math.round(thumbnailWidth), thumbnailHeight: Math.round(thumbnailHeight) };
}

/**
 * Creates a thumbnail from a data URL.
 */
export function createThumbnail(
  dataUrl: string,
  maxWidth: number | null = null,
  maxHeight: number | null = null,
  type = 'image/jpeg',
): Promise<string> {
  if (!dataUrl.includes('data:')) {
    dataUrl = `data:image/jpeg;base64,${dataUrl}`;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      const { thumbnailWidth, thumbnailHeight } = calculateThumbnailSize(img.width, img.height, maxWidth, maxHeight);

      canvas.width = thumbnailWidth;
      canvas.height = thumbnailHeight;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, thumbnailWidth, thumbnailHeight);
      ctx.drawImage(img, 0, 0, thumbnailWidth, thumbnailHeight);

      const thumbnailDataUrl = canvas.toDataURL(type);
      resolve(thumbnailDataUrl);
    };

    img.onerror = () => {
      reject(new Error('Failed to load the image.'));
    };
  });
}

/**
 * Compress an image if it exceeds the size threshold or has an unsafe mime type.
 * @param image Data URL of the image.
 * @param forceResize If true, forces resize regardless of size.
 * @param maxSizeThreshold Bytes threshold (default 2MB).
 */
export async function compressImage(
  image: string,
  forceResize = false,
  maxSizeThreshold = 2 * 1024 * 1024,
): Promise<string> {
  // Approximate size calculation for Base64 (3/4 of string length)
  const dataSize = image.length * 0.75;
  const safeMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const mimeType = image.split(';')?.[0]?.split(':')?.[1];

  // If we need to compress due to size or unsafe type
  if (forceResize || dataSize > maxSizeThreshold || (mimeType && !safeMimeTypes.includes(mimeType))) {
    const maxSide = 2048;
    // createThumbnail handles the resizing and conversion to jpeg if type not specified (defaults to image/jpeg)
    // If original was transparent png, it becomes white background jpeg which is usually safer for LLMs
    return await createThumbnail(image, maxSide, maxSide);
  }

  return image;
}

/**
 * Gets the dimensions of an image from a Data URL.
 */
export function getImageSizeFromDataURL(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error('Failed to load image for size calculation'));
    img.src = dataUrl;
  });
}

/**
 * Calculates token cost for an image based on OpenAI vision pricing.
 * @param dataUrl Image data URL
 * @param quality 'low' | 'high' | 'auto'
 */
export async function getImageTokenCost(dataUrl: string, quality: 'low' | 'high' | 'auto'): Promise<number> {
  const TOKENS_PER_IMAGE_LOW = 85;

  if (quality === 'low') {
    return TOKENS_PER_IMAGE_LOW;
  }

  const size = await getImageSizeFromDataURL(dataUrl);

  if (quality === 'auto' && size.width <= 512 && size.height <= 512) {
    return TOKENS_PER_IMAGE_LOW;
  }

  // OpenAI High Detail calculation
  const scale = 2048 / Math.min(size.width, size.height);
  const scaledWidth = Math.round(size.width * scale);
  const scaledHeight = Math.round(size.height * scale);

  const finalScale = 768 / Math.min(scaledWidth, scaledHeight);
  const finalWidth = Math.round(scaledWidth * finalScale);
  const finalHeight = Math.round(scaledHeight * finalScale);

  const squares = Math.ceil(finalWidth / 512) * Math.ceil(finalHeight / 512);
  const tokens = squares * 170 + 85;
  return tokens;
}

/**
 * Gets audio/video duration from a Data URL.
 * Returns duration in seconds.
 */
export function getMediaDurationFromDataURL(dataUrl: string, type: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(type);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      resolve(element.duration);
    };
    element.onerror = () => {
      reject(new Error(`Failed to load ${type} metadata`));
    };
    element.src = dataUrl;
  });
}
