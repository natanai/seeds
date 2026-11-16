"use strict";

const SeedTools = (() => {
  const packedSeeds = typeof module === "object" ? require("./force-fit.js") : ForceFit;
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
  const digits = /^\d+$/;
  const signedInteger = /^-?\d+$/;
  const lettersAndDigits = /^[A-Z0-9]+$/;
  const normalize = (text) => text.replace(/[^A-Za-z0-9 ]+/g, "").toUpperCase();

  function encodeMultiTap(text) {
    let output = "";
    let previousKey = "";
    const letters = normalize(text);
    for (let index = 0; index < letters.length; index++) {
      const letter = letters[index];
      if (letter === " ") {
        const nextKey = letterKeys[letters[index + 1]]?.[0];
        output += previousKey && previousKey === nextKey ? "1" : "0";
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

  function decodeMultiTap(seed, trace) {
    if (!/^[2-9]\d*$/.test(seed)) return "";
    const runs = seed.match(/(\d)\1*/g);
    let text = "";
    for (const [index, run] of runs.entries()) {
      const key = run[0];
      if (key === "0" || key === "1") {
        const previousKey = runs[index - 1][0];
        const sameKey = Boolean(KEYMAP[previousKey] && previousKey === runs[index + 1]?.[0]);
        if (key === "1" && (run.length !== 1 || !sameKey)) return "";
        if (key === "0" && run.length === 1 && sameKey) {
          trace?.push([run, "same-key separator"]);
          continue;
        }
        trace?.push([run, "␠".repeat(run.length)]);
        text += " ".repeat(run.length);
        continue;
      }
      const letter = KEYMAP[key][run.length - 1];
      if (!letter) return "";
      trace?.push([run, letter]);
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

  function reversibleMethod(label, transform, rule, { requiresLetters = false, inverse = transform } = {}) {
    const changed = (text, operation) => {
      const transformed = operation(text);
      return transformed === text ? "" : transformed;
    };
    return {
      label, rule, requiresLetters, reversible: true,
      encode: (text) => changed(text, transform), decode: (text) => changed(text, inverse)
    };
  }

  const lookalikes = "OIZEASGTB";
  const pairs = "O↔0, I↔1, Z↔2, E↔3, A↔4, S↔5, G↔6, T↔7, B↔8.";

  function valheimValidity(seed) {
    return seed.length <= VALHEIM_LIMIT && !/[\r\n\uD800-\uDFFF]/u.test(seed)
      ? "" : "Use up to 10 characters on one line. Emoji can take two spots.";
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
    if (code.length !== 8 || !lettersAndDigits.test(code) || /[IOU]/.test(code)) {
      return "Use 8 letters or digits, excluding I, O and U.";
    }
    return packedSeeds.validIsaacSeed(seed) ? "" : "Check the seed.";
  }

  function alphanumeric(seed, minimum, maximum) {
    const code = seed.replace(/\s+/g, "").toUpperCase();
    return lettersAndDigits.test(code) && code.length >= minimum && code.length <= maximum
      ? "" : `Use ${minimum} to ${maximum} letters or digits.`;
  }

  const METHODS = {
    mtap: {
      label: "Multi-tap (0 separators)",
      ignoresCase: true,
      encode: encodeMultiTap,
      decode: decodeMultiTap,
      runs(seed) {
        const trace = [];
        decodeMultiTap(seed, trace);
        return trace;
      },
      rule: "Repeat the phone key once per tap. A zero separates consecutive letters on the same key. A single space between letters on that key uses 1. Other spaces use 0. Leading zeros are removed."
    },
    pair: {
      label: "Keypad [key][press]",
      ignoresCase: true,
      encode: encodePair,
      decode: decodePair,
      rule: "Write the phone key and the 1-based tap count for each letter. Decode consumes two digits per letter. For example, 23 is the third letter on key 2, C."
    },
    fixed: {
      label: "A1Z26 (fixed)",
      ignoresCase: true,
      encode: (text) => encodeAlphabet(text, ""),
      decode: decodeAlphabetFixed,
      rule: "Write the letter’s 1-based alphabet position as two decimal digits, from A = 01 to Z = 26. Decode reads two digits at a time."
    },
    separated: {
      label: "A1Z26 (dashes)",
      ignoresCase: true,
      usesSeparators: true,
      encode: (text) => encodeAlphabet(text, "-"),
      decode: decodeAlphabetSeparated,
      rule: "Write each 1-based alphabet position in decimal and join with dashes. Decode accepts dashes, whitespace, or commas between positions."
    },
    base36: {
      label: "Base 36 → decimal",
      ignoresCase: true,
      encode: encodeBase36,
      decode: decodeBase36,
      rule: "Use the alphabet 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ. Start at 0 and multiply by 36 before adding each digit’s value. Write the integer in decimal. Decode converts the integer back to base 36."
    },
    upperLookalikes: reversibleMethod("Look-alikes (A↔4)",
      (text) => swapLookalikes(text, lookalikes), "Swap " + pairs),
    lowerLookalikes: reversibleMethod("Look-alikes (a↔4)",
      (text) => swapLookalikes(text, lookalikes.toLowerCase()), "Swap " + pairs.toLowerCase()),
    flipCase: reversibleMethod("Flip case",
      (text) => text.replace(/[A-Za-z]/g, (letter) =>
        letter <= "Z" ? letter.toLowerCase() : letter.toUpperCase()),
      "Switch A–Z to lowercase and a–z to uppercase.", { requiresLetters: true }),
    reverse: reversibleMethod("Reverse", reverse, "Reverse the Unicode code points. The same reversal restores their order."),
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
      roll: valheimRoll
    },
    "going-medieval": {
      label: "Going Medieval",
      validate: unsigned32,
      numeric: true,
      roll: (random) => String(random.getRandomValues(new Uint32Array(1))[0])
    },
    lego: { label: "LEGO Fortnite", validate: lego, numeric: true },
    midjourney: { label: "Midjourney", validate: unsigned32, numeric: true },
    minecraft: { label: "Minecraft (numeric)", validate: minecraft },
    terraria: {
      label: "Terraria", allowsSeparators: true,
      validate: (seed) => seed.trim() ? "" : "Enter a seed."
    },
    isaac: { label: "Binding of Isaac", validate: isaac, allowsLetters: true },
    sts: { label: "Slay the Spire", validate: (seed) => alphanumeric(seed, 8, 16), allowsLetters: true },
    spelunky2: {
      label: "Spelunky 2", validate: (seed) => /^[0-9A-F]{8}$/i.test(seed) ? "" : "Use eight hexadecimal digits.",
      allowsLetters: true
    },
    deadcells: {
      label: "Dead Cells",
      validate: (seed) => /^\d{6}$/.test(seed) ? "" : "Use 6 digits.",
      numeric: true
    },
    factorio: { label: "Factorio", validate: unsigned32, numeric: true }
  };

  const alphabetPositions = Array.from({ length: 26 }, (_, index) => String(index + 1));

  function matchingMethods(game) {
    const { allowsSeparators, allowsLetters, validate } = PRESETS[game];
    const allowsAlphabetCode = allowsSeparators || alphabetPositions.some((code) => !validate(code));
    return Object.entries(METHODS).filter(([, method]) =>
      (!method.usesSeparators || allowsAlphabetCode) &&
      (!method.requiresLetters || allowsLetters || allowsSeparators));
  }

  function normalizesDecimal(game) {
    return game === "minecraft" || (PRESETS[game].numeric && game !== "deadcells");
  }

  function canonicalSeed(game, seed) {
    return normalizesDecimal(game) && signedInteger.test(seed) ? BigInt(seed).toString() : seed;
  }

  function methodInput(game, id, seed) {
    if (id !== "fixed" || !normalizesDecimal(game) || !digits.test(seed)) return seed;
    const decimal = canonicalSeed(game, seed);
    // A1Z26 pairs need at most one leading zero. The digit count identifies it uniquely.
    return decimal.length % 2 ? "0" + decimal : decimal;
  }

  function matchesReading(method, reading, keyword) {
    // Only fold ASCII letter case. Spaces, punctuation, and other characters still have to match.
    return reading === keyword || Boolean(method?.ignoresCase &&
      reading === keyword.replace(/[a-z]/g, (letter) => letter.toUpperCase()));
  }

  function caseReadings(method, value) {
    if (!method.ignoresCase) return [value];
    const lower = value.toLowerCase();
    const title = lower.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    return [...new Set([value, lower, title])];
  }

  return { KEYMAP, METHODS, PRESETS, matchingMethods, matchesReading, caseReadings, canonicalSeed, methodInput, normalize };
})();

if (typeof module === "object") module.exports = SeedTools;
