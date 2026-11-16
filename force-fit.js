"use strict";

const ForceFit = (() => {
  const LOWERCASE = " abcdefghijklmnopqrstuvwxyz";
  const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const HEX = "0123456789ABCDEF";
  const ISAAC = "ABCDEFGHJKLMNPQRSTWXYZ01234V6789";
  const U32_MAX = 4294967295n;
  // Fractions of the game's available slots. Keep these stable for existing seeds.
  const OFFSETS = [0n, 618n, 236n, 854n, 472n, 90n, 708n, 326n];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const encoder = new TextEncoder();

  function writeDigits(index, alphabet, width) {
    const base = BigInt(alphabet.length);
    let text = "";
    for (let offset = 0; offset < width; offset++) {
      text = alphabet[Number(index % base)] + text;
      index /= base;
    }
    return text;
  }

  function readDigits(text, alphabet) {
    const base = BigInt(alphabet.length);
    let index = 0n;
    for (const symbol of text) {
      const digit = alphabet.indexOf(symbol);
      if (digit < 0) return null;
      index = index * base + BigInt(digit);
    }
    return index;
  }

  function alphabetSpace(alphabet, width, prefix, format) {
    return {
      capacity: BigInt(alphabet.length) ** BigInt(width),
      format,
      write: (index) => prefix + writeDigits(index, alphabet, width),
      read(seed) {
        if (seed.length !== width + prefix.length || !seed.startsWith(prefix)) return null;
        return readDigits(seed.slice(prefix.length), alphabet);
      }
    };
  }

  function decimalSpace(minimum, maximum, width = 0) {
    let format = "Write the slot as decimal.";
    if (width) format = "Write the slot as decimal, padded to " + width + " digits.";
    if (minimum !== 0n) format = "Add " + minimum + " to the slot and write it as decimal.";
    return {
      capacity: maximum - minimum + 1n,
      format,
      write: (index) => String(minimum + index).padStart(width, "0"),
      read(seed) {
        if (!/^-?\d+$/.test(seed) || seed.length > 20) return null;
        return BigInt(seed) - minimum;
      }
    };
  }

  // Isaac's 32-bit run seed has a base-32 representation with an 8-bit checksum.
  // https://stackoverflow.com/questions/77782389
  function isaacChecksum(index) {
    let byte = 0;
    for (let remaining = Number(index); remaining !== 0; remaining >>>= 5) {
      byte = (byte + (remaining & 255)) & 255;
      byte = ((byte << 1) | (byte >>> 7)) & 255;
    }
    return BigInt(byte);
  }

  const unsigned32 = decimalSpace(0n, U32_MAX);
  const positive31 = decimalSpace(1n, 2147483647n);
  const spaces = {
    valheim: alphabetSpace(BASE62, 9, "~", "Write the slot in base 62 (0–9, A–Z, a–z), padded to 9 digits, after ~."),
    "going-medieval": unsigned32,
    lego: positive31,
    midjourney: unsigned32,
    minecraft: decimalSpace(-9223372036854775808n, 9223372036854775807n),
    terraria: decimalSpace(0n, 2147483647n),
    isaac: {
      capacity: U32_MAX,
      format: "Add 1 to the slot and write it as a checksummed Isaac run seed.",
      write(index) {
        const number = index + 1n;
        return writeDigits(((number ^ 0x0fef7ffdn) << 8n) | isaacChecksum(number), ISAAC, 8);
      },
      read(seed) {
        const digits = seed.toUpperCase().replace(/\s+/g, "");
        if (digits.length !== 8) return null;
        const token = readDigits(digits, ISAAC);
        if (token === null) return null;
        const number = (token >> 8n) ^ 0x0fef7ffdn;
        return isaacChecksum(number) === (token & 255n) ? number - 1n : null;
      }
    },
    sts: decimalSpace(0n, 999999999999n, 12),
    spelunky2: alphabetSpace(HEX, 8, "", "Write the slot as eight hexadecimal digits."),
    deadcells: decimalSpace(0n, 999999n, 6),
    factorio: unsigned32
  };

  function hasSpace(game) {
    return Object.hasOwn(spaces, game);
  }

  function rank(sequence, radix, digitOf, ceiling) {
    let index = 0n;
    for (const symbol of sequence) {
      const digit = digitOf(symbol);
      if (digit < 0) return null;
      index = index * radix + BigInt(digit + 1);
      if (index > ceiling) return null;
    }
    return index;
  }

  function unrank(index, radix) {
    const digits = [];
    while (index > 0n) {
      index--;
      digits.push(Number(index % radix));
      index /= radix;
    }
    return digits.reverse();
  }

  function hash64(bytes) {
    let hash = 14695981039346656037n;
    for (const byte of bytes) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
    }
    return hash;
  }

  // Each third slot carries a byte string, a compact string, or an overflow hash.
  // These disjoint slot ranges keep a hash from decoding as someone else's keyword.
  function encode(game, keyword) {
    if (!hasSpace(game) || !keyword) return null;
    const space = spaces[game];
    const compact = rank(keyword, 27n, (character) => LOWERCASE.indexOf(character),
      (space.capacity + 1n) / 3n);
    if (compact !== null) {
      const index = (compact - 1n) * 3n + 1n;
      return { seed: space.write(index), kind: "compact", index, format: space.format };
    }

    const bytes = encoder.encode(keyword);
    const full = rank(bytes, 256n, (byte) => byte, space.capacity / 3n);
    if (full !== null && decoder.decode(bytes) === keyword) {
      const index = (full - 1n) * 3n + 2n;
      return { seed: space.write(index), kind: "bytes", index, format: space.format };
    }

    const slots = (space.capacity + 2n) / 3n;
    const hash = hash64(bytes);
    const index = (hash % slots) * 3n;
    return { seed: space.write(index), kind: "hash", index, hash, slots, format: space.format };
  }

  function shiftSlot(space, index, variant, undo = false) {
    // Shift inside the same lane so an overflow hash always stays an overflow hash.
    const lane = index % 3n;
    const slots = (space.capacity + 2n - lane) / 3n;
    const offset = slots * OFFSETS[variant] / 1000n;
    const position = (index / 3n + (undo ? slots - offset : offset)) % slots;
    return { index: position * 3n + lane, offset, slots };
  }

  function encodeVariants(game, keyword) {
    const base = encode(game, keyword);
    if (!base) return [];
    const space = spaces[game];
    return OFFSETS.map((_, variant) => {
      const shifted = shiftSlot(space, base.index, variant);
      return { ...base, ...shifted, variant, seed: space.write(shifted.index) };
    });
  }

  function seedIndex(game, seed) {
    if (!hasSpace(game)) return null;
    const space = spaces[game];
    const index = space.read(seed);
    return index !== null && index >= 0n && index < space.capacity ? index : null;
  }

  function decodeSlot(game, index) {
    const tag = index % 3n;
    if (tag === 0n) return { kind: "hash" };

    const digits = unrank(index / 3n + 1n, tag === 1n ? 27n : 256n);
    let keyword;
    try {
      keyword = tag === 1n
        ? digits.map((digit) => LOWERCASE[digit]).join("")
        : decoder.decode(Uint8Array.from(digits));
    } catch {
      return null;
    }
    const result = encode(game, keyword);
    return result?.index === index ? { keyword, ...result } : null;
  }

  function decode(game, seed) {
    const index = seedIndex(game, seed);
    return index === null ? null : decodeSlot(game, index);
  }

  function decodeVariants(game, seed) {
    const index = seedIndex(game, seed);
    if (index === null || index % 3n === 0n) return [];
    const space = spaces[game];
    return OFFSETS.flatMap((_, variant) => {
      const decoded = decodeSlot(game, shiftSlot(space, index, variant, true).index);
      return decoded?.keyword ? [{ keyword: decoded.keyword, variant }] : [];
    });
  }

  function validIsaacSeed(seed) {
    return seedIndex("isaac", seed) !== null;
  }

  return { hasSpace, encode, encodeVariants, decode, decodeVariants, validIsaacSeed };
})();

if (typeof module === "object") module.exports = ForceFit;
