// RFC 4648 base32, lowercase alphabet, no padding — used for the `orca1…`
// chain ID derivation (design §4.2). Only the encode direction is needed.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function base32LowerNoPad(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}
