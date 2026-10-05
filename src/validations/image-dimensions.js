export const MAX_IMAGE_HEIGHT = 8_000;
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_WIDTH = 8_000;

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const HEIF_DIMENSION_BOX = Buffer.from("ispe");

function dimensionsAreSafe(dimensions) {
  if (!dimensions) return false;
  const { height, width } = dimensions;
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= MAX_IMAGE_WIDTH
    && height <= MAX_IMAGE_HEIGHT
    && width * height <= MAX_IMAGE_PIXELS;
}

function readJpegDimensions(data) {
  let offset = 2;
  while (offset < data.length) {
    while (data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;

    if (marker == null || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) return null;

    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) return null;
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readPngDimensions(data) {
  if (data.length < 24 || data.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return {
    height: data.readUInt32BE(20),
    width: data.readUInt32BE(16),
  };
}

function readWebpDimensions(data) {
  if (data.length < 30) return null;
  const variant = data.subarray(12, 16).toString("ascii");
  if (variant === "VP8X") {
    return {
      height: data.readUIntLE(27, 3) + 1,
      width: data.readUIntLE(24, 3) + 1,
    };
  }
  if (variant === "VP8 " && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return {
      height: data.readUInt16LE(28) & 0x3fff,
      width: data.readUInt16LE(26) & 0x3fff,
    };
  }
  if (variant === "VP8L" && data[20] === 0x2f && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return {
      height: ((bits >> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    };
  }
  return null;
}

function readHeifDimensions(data) {
  const dimensions = [];
  let offset = data.indexOf(HEIF_DIMENSION_BOX);
  while (offset >= 4 && offset + 16 <= data.length) {
    const boxStart = offset - 4;
    const boxSize = data.readUInt32BE(boxStart);
    if (boxSize >= 20 && boxStart + boxSize <= data.length) {
      dimensions.push({
        height: data.readUInt32BE(offset + 12),
        width: data.readUInt32BE(offset + 8),
      });
    }
    offset = data.indexOf(HEIF_DIMENSION_BOX, offset + HEIF_DIMENSION_BOX.length);
  }
  if (!dimensions.length) return null;
  return dimensions;
}

export function hasSafeImageDimensions(data, mediaType) {
  if (mediaType === "image/jpeg") return dimensionsAreSafe(readJpegDimensions(data));
  if (mediaType === "image/png") return dimensionsAreSafe(readPngDimensions(data));
  if (mediaType === "image/webp") return dimensionsAreSafe(readWebpDimensions(data));
  if (mediaType === "image/heic" || mediaType === "image/heif") {
    const dimensions = readHeifDimensions(data);
    return Boolean(dimensions) && dimensions.every(dimensionsAreSafe);
  }
  return false;
}
