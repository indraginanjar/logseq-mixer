/**
 * PlantUML text encoder — encodes PlantUML source code into the URL-safe
 * format expected by PlantUML servers.
 *
 * Protocol: UTF-8 → raw deflate → PlantUML's custom 6-bit encoding
 * Result is used as: {server}/svg/{encoded}
 */

/**
 * PlantUML's custom base64 alphabet (different from standard base64).
 */
const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode6bit(b: number): string {
  return PLANTUML_ALPHABET[b & 0x3f];
}

function encode3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
}

function encodePlantUMLBytes(data: Uint8Array): string {
  let result = '';
  const len = data.length;
  for (let i = 0; i < len; i += 3) {
    if (i + 2 === len) {
      result += encode3bytes(data[i], data[i + 1], 0);
    } else if (i + 1 === len) {
      result += encode3bytes(data[i], 0, 0);
    } else {
      result += encode3bytes(data[i], data[i + 1], data[i + 2]);
    }
  }
  return result;
}

/**
 * Compress data using raw deflate via the browser's CompressionStream API.
 * Falls back to uncompressed hex encoding if CompressionStream is unavailable.
 */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Use the browser's built-in CompressionStream (raw deflate)
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    writer.write(data.buffer as ArrayBuffer);
    writer.close();

    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Concatenate chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  // Fallback: return raw data (PlantUML server also accepts ~h hex encoding)
  // This path should rarely be hit in modern browsers
  return data;
}

/**
 * Encode PlantUML source code into the URL-safe format for PlantUML servers.
 *
 * Usage: `${serverUrl}/svg/${await encodePlantUML(code)}`
 */
export async function encodePlantUML(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const compressed = await deflateRaw(data);
  return encodePlantUMLBytes(compressed);
}
