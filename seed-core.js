"use strict";

const SeedTools = (() => {
  const U32_MAX = 4294967295n;
  const I64_MIN = -9223372036854775808n;
  const I64_MAX = 9223372036854775807n;
  const KEYMAP = {
    "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL",
    "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ"
  };
  const letterKeys = Object.fromEntries(
    Object.entries(KEYMAP).flatMap(([key, letters]) =>
      [...letters].map((letter, index) => [letter, [key, index + 1]])
    )
  );
  const MAP_TYPES = ["Valley", "Hillside", "Mountain", "Marsh"];
  const MAP_SIZES = ["Small", "Medium", "Large"];
  const digits = /^\d+$/;
  const signedInteger = /^-?\d+$/;
  const lettersAndDigits = /^[A-Z0-9]+$/;
  const normalize = (text) => text.replace(/[^A-Za-z0-9 ]+/g, "").toUpperCase();

  function encodeMultiTap(text) {
    let output = "";
    let previousKey = "";
    for (const letter of normalize(text)) {
      if (letter === " ") {
        output += "0";
        previousKey = "";
        continue;
      }
      const [key, presses] = letterKeys[letter] ?? [letter, 1];
      if (key === previousKey) output += "0";
      output += key.repeat(presses);
      previousKey = key;
    }
    return output.replace(/^0+/, "");
  }

  function decodeMultiTap(seed) {
    if (!/^[2-9][02-9]*$/.test(seed)) return "";
    const runs = seed.match(/([02-9])\1*/g);
    let text = "";
    for (const [index, run] of runs.entries()) {
      const key = run[0];
      if (key === "0") {
        if (run.length === 1 && runs[index - 1][0] === runs[index + 1]?.[0]) continue;
        text += " ".repeat(run.length);
        continue;
      }
      const letter = KEYMAP[key][run.length - 1];
      if (!letter) return "";
      text += letter;
    }
    return text;
  }

  function encodePair(text) {
    return [...normalize(text)].map((letter) => letterKeys[letter]?.join("") ?? "").join("");
  }

  function decodePair(seed) {
    if (!/^(?:[2-9][1-4])+$/.test(seed)) return "";
    const pairs = seed.match(/../g);
    const letters = pairs.map(([key, presses]) => KEYMAP[key][Number(presses) - 1]);
    return letters.includes(undefined) ? "" : letters.join("");
  }

  function encodeAlphabet(text, separator) {
    const letters = normalize(text).replace(/[^A-Z]/g, "");
    return [...letters].map((letter) => {
      const value = String(letter.charCodeAt(0) - 64);
      return separator ? value : value.padStart(2, "0");
    }).join(separator);
  }

  function decodeAlphabet(tokens) {
    const numbers = tokens.map(Number);
    if (numbers.some((number) => number < 1 || number > 26)) return "";
    return numbers.map((number) => String.fromCharCode(64 + number)).join("");
  }

  function decodeAlphabetFixed(seed) {
    return /^(?:\d\d)+$/.test(seed) ? decodeAlphabet(seed.match(/../g)) : "";
  }

  function decodeAlphabetSeparated(seed) {
    const text = seed.trim();
    return /^\d+(?:[-\s,]+\d+)*$/.test(text) ? decodeAlphabet(text.match(/\d+/g)) : "";
  }

  function encodeBase36(text) {
    const normalized = normalize(text).replace(/ /g, "");
    if (!normalized) return "";
    let value = 0n;
    for (const character of normalized) {
      value = value * 36n + BigInt(parseInt(character, 36));
    }
    return value.toString();
  }

  function decodeBase36(seed) {
    return signedInteger.test(seed) ? BigInt(seed).toString(36).toUpperCase() : "";
  }

  // 32-bit FNV-1a over UTF-8. Keep this stable so old phrases produce the same seeds.
  function hashPhrase(phrase) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(phrase)) {
      hash = Math.imul(hash ^ byte, 16777619);
    }
    return hash >>> 0;
  }

  function valheimPhrase(phrase) {
    if (!phrase) return "";
    if (phrase.length <= 10 && !/[\r\n]/.test(phrase)) return phrase;
    const prefix = phrase.replace(/[^A-Za-z0-9]/g, "").slice(0, 3);
    return prefix + hashPhrase(phrase).toString(36).toUpperCase().padStart(7, "0");
  }

  function valheimRoll(random) {
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    return Array.from(random.getRandomValues(new Uint32Array(10)),
      (value) => alphabet[value % alphabet.length]).join("");
  }

  // Validation functions return an empty string for a seed that fits the preset.
  function unsigned32(seed) {
    if (!digits.test(seed)) return "Use decimal digits.";
    return BigInt(seed) > U32_MAX ? "Maximum seed is 4,294,967,295." : "";
  }

  function lego(seed) {
    if (!digits.test(seed)) return "Use decimal digits.";
    if (seed.length > 10 || BigInt(seed) > 2147483647n || BigInt(seed) < 1n) {
      return "Use a seed from 1 to 2,147,483,647.";
    }
    return "";
  }

  function minecraft(seed) {
    if (!signedInteger.test(seed)) return "Use a signed decimal seed.";
    const number = BigInt(seed);
    return number < I64_MIN || number > I64_MAX ? "Outside the signed 64-bit range." : "";
  }

  function isaac(seed) {
    const code = seed.replace(/\s+/g, "").toUpperCase();
    return code.length === 8 && lettersAndDigits.test(code) && !/[IOUV]/.test(code)
      ? "" : "Use 8 letters or digits, excluding I, O, U and V.";
  }

  function alphanumeric(seed, minimum, maximum) {
    const code = seed.replace(/\s+/g, "").toUpperCase();
    return lettersAndDigits.test(code) && code.length >= minimum && code.length <= maximum
      ? "" : `Use ${minimum} to ${maximum} letters or digits.`;
  }

  const METHODS = {
    mtap: {
      label: "Multi-tap",
      encode: encodeMultiTap,
      decode: decodeMultiTap,
      hint: "A zero can be a space or separate letters on one key.",
      invalid: "Use tap runs on keys 2–9, separated by 0."
    },
    pair: {
      label: "Keypad pairs",
      encode: encodePair,
      decode: decodePair,
      hint: "One key digit and one tap count per letter. C = 23.",
      invalid: "Use a key and a valid tap count for each letter."
    },
    fixed: {
      label: "A1Z26 fixed",
      encode: (text) => encodeAlphabet(text, ""),
      decode: decodeAlphabetFixed,
      hint: "Two digits per letter, from 01 to 26.",
      invalid: "Use pairs of digits from 01 to 26."
    },
    separated: {
      label: "A1Z26 separated",
      encode: (text) => encodeAlphabet(text, "-"),
      decode: decodeAlphabetSeparated,
      hint: "Alphabet positions with separators. SEED = 19-5-5-4.",
      invalid: "Use tokens from 1 to 26 separated by hyphens or spaces."
    },
    base36: {
      label: "Base 36",
      encode: encodeBase36,
      decode: decodeBase36,
      hint: "A number with digits 0–9 and letters A–Z.",
      invalid: "Use a decimal integer."
    }
  };

  const PRESETS = {
    none: { label: "Any format", validate: () => "" },
    valheim: {
      label: "Valheim",
      validate: (seed) => seed.length <= 10 && !/[\r\n]/.test(seed)
        ? "" : "Use up to 10 characters on one line.",
      encode: valheimPhrase,
      roll: valheimRoll
    },
    "going-medieval": {
      label: "Going Medieval",
      validate: unsigned32,
      numeric: true,
      encode: (phrase) => phrase ? String(hashPhrase(phrase)) : "",
      roll: (random) => String(random.getRandomValues(new Uint32Array(1))[0])
    },
    lego: { label: "LEGO Odyssey", validate: lego, numeric: true },
    midjourney: { label: "Midjourney", validate: unsigned32, numeric: true },
    minecraft: { label: "Minecraft (numeric)", validate: minecraft },
    terraria: { label: "Terraria", validate: (seed) => seed.trim() ? "" : "Enter a seed." },
    isaac: { label: "Binding of Isaac", validate: isaac },
    sts: { label: "Slay the Spire", validate: (seed) => alphanumeric(seed, 8, 16) },
    spelunky2: { label: "Spelunky 2", validate: (seed) => alphanumeric(seed, 6, 12) },
    deadcells: {
      label: "Dead Cells",
      validate: (seed) => /^\d{6}$/.test(seed) ? "" : "Use 6 digits.",
      numeric: true
    },
    factorio: { label: "Factorio", validate: unsigned32, numeric: true }
  };
  function makeSeed(game, seed, settings = {}) {
    if (!Object.hasOwn(PRESETS, game) || typeof seed !== "string" ||
        !seed || PRESETS[game].validate(seed)) return null;
    const record = { game, seed };
    if (game === "going-medieval") {
      if (MAP_TYPES.includes(settings.terrain)) record.terrain = settings.terrain;
      if (MAP_SIZES.includes(settings.size)) record.size = settings.size;
    }
    return record;
  }

  function seedKey(record) {
    return JSON.stringify([record.game, record.seed, record.terrain, record.size]);
  }

  function seedLink(page, record) {
    const link = new URL(page);
    link.search = "";
    link.hash = "";
    for (const [key, value] of Object.entries(record)) {
      link.searchParams.set(key, value);
    }
    return link.href;
  }

  return { KEYMAP, MAP_TYPES, MAP_SIZES, METHODS, PRESETS, makeSeed, seedKey, seedLink };
})();

if (typeof module === "object") module.exports = SeedTools;
