"use strict";

const SeedTools = (() => {
  const U32_MAX = 4294967295n;
  const I64_MIN = -9223372036854775808n;
  const I64_MAX = 9223372036854775807n;
  const VALHEIM_LIMIT = 10;
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

  function swapLookalikes(text, letters) {
    return text.replace(/[0-8A-Za-z]/g, (character) => {
      const index = letters.indexOf(character);
      if (index >= 0) return String(index);
      return letters[Number(character)] ?? character;
    });
  }

  function reverse(text) {
    return [...text].reverse().join("");
  }

  function reversibleMethod(label, transform, steps, { requiresLetters = false, inverse = transform } = {}) {
    const changed = (text, operation) => {
      const transformed = operation(text);
      return transformed === text ? "" : transformed;
    };
    return {
      label, steps, requiresLetters, hint: steps,
      encode: (text) => changed(text, transform), decode: (text) => changed(text, inverse),
      invalid: "The keyword is identical under this transformation."
    };
  }

  const lookalikes = "OIZEASGTB";
  const pairs = "O↔0, I↔1, Z↔2, E↔3, A↔4, S↔5, G↔6, T↔7, B↔8.";

  // 32-bit FNV-1a over UTF-8. Keep this stable for existing keywords.
  function hashKeyword(keyword) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(keyword)) {
      hash = Math.imul(hash ^ byte, 16777619);
    }
    return hash >>> 0;
  }

  function valheimValidity(seed) {
    return seed.length <= VALHEIM_LIMIT && !/[\r\n]/.test(seed)
      ? "" : "Use up to 10 UTF-16 units on one line.";
  }

  function valheimKeyword(keyword) {
    if (!valheimValidity(keyword)) return { seed: keyword };
    const prefix = keyword.replace(/[^A-Za-z0-9]/g, "").slice(0, 3);
    const suffix = hashKeyword(keyword).toString(36).toUpperCase().padStart(7, "0");
    return { seed: prefix + suffix, prefix, suffix };
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
    return code.length === 8 && lettersAndDigits.test(code) && !/[IOU]/.test(code)
      ? "" : "Use 8 letters or digits, excluding I, O and U.";
  }

  function alphanumeric(seed, minimum, maximum) {
    const code = seed.replace(/\s+/g, "").toUpperCase();
    return lettersAndDigits.test(code) && code.length >= minimum && code.length <= maximum
      ? "" : `Use ${minimum} to ${maximum} letters or digits.`;
  }

  const METHODS = {
    mtap: {
      label: "Phone key repeats",
      encode: encodeMultiTap,
      decode: decodeMultiTap,
      hint: "Replace letters with repeated phone keys. A zero marks a space or separates letters on the same key.",
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
      label: "Two digits per letter",
      encode: (text) => encodeAlphabet(text, ""),
      decode: decodeAlphabetFixed,
      hint: "Replace each letter with its place in the alphabet. A becomes 01 and Z becomes 26.",
      invalid: "Use pairs of digits from 01 to 26."
    },
    separated: {
      label: "Letter numbers with dashes",
      usesSeparators: true,
      encode: (text) => encodeAlphabet(text, "-"),
      decode: decodeAlphabetSeparated,
      hint: "Replace letters with their alphabet positions and put dashes between them. SEED becomes 19-5-5-4.",
      invalid: "Use tokens from 1 to 26 separated by hyphens or spaces."
    },
    base36: {
      label: "Letters as digits",
      encode: encodeBase36,
      decode: decodeBase36,
      hint: "Read letters as extra digits, with A after 9. Then write that number in ordinary digits.",
      invalid: "Use a decimal integer."
    },
    upperLookalikes: reversibleMethod("Look-alikes (A↔4)",
      (text) => swapLookalikes(text, lookalikes), "Swap " + pairs),
    lowerLookalikes: reversibleMethod("Look-alikes (a↔4)",
      (text) => swapLookalikes(text, lookalikes.toLowerCase()), "Swap " + pairs.toLowerCase()),
    flipCase: reversibleMethod("Flip case",
      (text) => text.replace(/[A-Za-z]/g, (letter) =>
        letter <= "Z" ? letter.toLowerCase() : letter.toUpperCase()),
      "Switch A–Z to lowercase and a–z to uppercase.", { requiresLetters: true }),
    reverse: reversibleMethod("Reverse", reverse, "Read the seed characters in reverse order."),
    rotate: reversibleMethod("Rotate characters",
      (text) => {
        const [first, ...rest] = [...text];
        return first ? rest.join("") + first : "";
      },
      "Move the first character to the end. To reverse it, move the last character to the front.",
      { inverse: (text) => {
        const characters = [...text];
        return (characters.pop() ?? "") + characters.join("");
      } }),
    reverseLookalikes: reversibleMethod("Reverse + look-alikes",
      (text) => reverse(swapLookalikes(text, lookalikes)), "Reverse the characters and swap " + pairs)
  };

  const PRESETS = {
    none: { label: "Any format", validate: () => "", allowsSeparators: true },
    valheim: {
      label: "Valheim",
      validate: valheimValidity,
      allowsSeparators: true,
      keyword: valheimKeyword,
      roll: valheimRoll
    },
    "going-medieval": {
      label: "Going Medieval",
      validate: unsigned32,
      numeric: true,
      keyword: (keyword) => ({ seed: keyword ? String(hashKeyword(keyword)) : "" }),
      roll: (random) => String(random.getRandomValues(new Uint32Array(1))[0])
    },
    lego: { label: "LEGO Odyssey", validate: lego, numeric: true },
    midjourney: { label: "Midjourney", validate: unsigned32, numeric: true },
    minecraft: { label: "Minecraft (numeric)", validate: minecraft },
    terraria: {
      label: "Terraria", allowsSeparators: true,
      validate: (seed) => seed.trim() ? "" : "Enter a seed."
    },
    isaac: { label: "Binding of Isaac", validate: isaac, allowsLetters: true },
    sts: { label: "Slay the Spire", validate: (seed) => alphanumeric(seed, 8, 16), allowsLetters: true },
    spelunky2: {
      label: "Spelunky 2", validate: (seed) => alphanumeric(seed, 6, 12), allowsLetters: true
    },
    deadcells: {
      label: "Dead Cells",
      validate: (seed) => /^\d{6}$/.test(seed) ? "" : "Use 6 digits.",
      numeric: true
    },
    factorio: { label: "Factorio", validate: unsigned32, numeric: true }
  };

  function matchingMethods(game) {
    // A separated code is a token list, even when a one-letter input has only one token.
    const { allowsSeparators, allowsLetters } = PRESETS[game];
    return Object.entries(METHODS).filter(([, method]) =>
      (!method.usesSeparators || allowsSeparators) &&
      (!method.requiresLetters || allowsLetters || allowsSeparators));
  }

  function makeSeed(game, seed, settings = {}) {
    if (!Object.hasOwn(PRESETS, game) || typeof seed !== "string" ||
        !seed || PRESETS[game].validate(seed)) return null;
    const record = { game, seed };
    if (game === "going-medieval") {
      if (MAP_TYPES.includes(settings.terrain)) record.terrain = settings.terrain;
      if (MAP_SIZES.includes(settings.size)) record.size = settings.size;
    }
    if (typeof settings.keyword === "string" && settings.keyword) record.keyword = settings.keyword;
    return record;
  }

  function seedKey(record) {
    return JSON.stringify([record.game, record.seed, record.terrain, record.size, record.keyword]);
  }

  function seedLink(page, record) {
    const link = new URL(page);
    link.search = "";
    link.hash = "";
    const { keyword, ...settings } = record;
    for (const [key, value] of Object.entries(settings)) {
      link.searchParams.set(key, value);
    }
    if (keyword !== undefined) {
      link.hash = new URLSearchParams({ keyword: JSON.stringify(keyword) }).toString();
    }
    return link.href;
  }

  function readSeedLink(value, page) {
    try {
      const link = new URL(value);
      const home = new URL(page);
      const path = (url) => url.pathname.replace(/\/index\.html$/, "/");
      if (link.origin !== home.origin || path(link) !== path(home)) return null;

      const game = link.searchParams.get("game");
      const seed = link.searchParams.get("seed");
      const fragment = new URLSearchParams(link.hash.slice(1));
      let keyword;
      try { keyword = JSON.parse(fragment.get("keyword")); } catch { /* The seed still opens. */ }
      return makeSeed(game, seed, {
        terrain: link.searchParams.get("terrain"), size: link.searchParams.get("size"), keyword
      });
    } catch {
      return null;
    }
  }

  return {
    KEYMAP, MAP_TYPES, MAP_SIZES, METHODS, PRESETS, VALHEIM_LIMIT,
    matchingMethods, makeSeed, seedKey, seedLink, readSeedLink
  };
})();

if (typeof module === "object") module.exports = SeedTools;
