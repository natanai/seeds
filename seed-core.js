"use strict";

const SeedTools = (() => {
  const packedSeeds = typeof module === "object" ? require("./packed-text.js") : PackedText;
  const U32_MAX = 4294967295n;
  const LEGO_MAX = 2147483647n;
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
  const nonLetters = /[^A-Za-z]+/g;
  const nonBase36 = /[^A-Za-z0-9]+/g;
  const nonMultiTap = /[^A-Za-z0-9 ]+/g;
  const normalize = (text, ignored = nonMultiTap) => text.replace(ignored, "").toUpperCase();

  function encodeMultiTap(text) {
    let output = "";
    let previousKey = "";
    const letters = normalize(text, nonMultiTap);
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
    return [...normalize(text, nonLetters)].map((letter) => letterKeys[letter].join("")).join("");
  }

  function decodePair(seed) {
    if (!/^(?:[2-9][1-4])+$/.test(seed)) return "";
    const pairs = seed.match(/../g);
    const letters = pairs.map(([key, presses]) => KEYMAP[key][Number(presses) - 1]);
    return letters.includes(undefined) ? "" : letters.join("");
  }

  function encodeAlphabet(text, separator) {
    const letters = normalize(text, nonLetters);
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
    const normalized = normalize(text, nonBase36);
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

  function quotePreview(value) {
    return value.length > 28 ? JSON.stringify(value.slice(0, 28)) + "…" : JSON.stringify(value);
  }

  function countLabel(count, unit) {
    return `${count} ${unit}${count === 1 ? "" : "s"}`;
  }

  function valheimValidity(seed) {
    if (/[\r\n]/.test(seed)) return "This seed contains a line break. Valheim seeds must be on one line.";
    const surrogate = seed.match(/[\uD800-\uDFFF]/u)?.[0];
    if (surrogate) return `This seed contains an unpaired UTF-16 surrogate (${JSON.stringify(surrogate)}).`;
    if (seed.length <= VALHEIM_LIMIT) return "";
    const characters = [...seed];
    const doubleWidth = characters.find((character) => character.length === 2);
    if (doubleWidth) {
      return `${countLabel(characters.length, "character")} take ${seed.length} spots. Valheim allows ${VALHEIM_LIMIT}. ` +
        `${JSON.stringify(doubleWidth)} takes two spots.`;
    }
    const unit = digits.test(seed) ? "digit" : "character";
    return `This seed has ${countLabel(seed.length, unit)}. Valheim allows ${VALHEIM_LIMIT} characters.`;
  }

  function valheimRoll(random) {
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    return Array.from(random.getRandomValues(new Uint32Array(10)),
      (value) => alphabet[value % alphabet.length]).join("");
  }

  function characterError(seed, invalid, allowed) {
    const character = seed.match(invalid)?.[0];
    return character ? `This seed contains ${JSON.stringify(character)}. Use ${allowed}.` : "";
  }

  function sizeError(seed, min, max, unit) {
    if (seed.length >= min && seed.length <= max) return "";
    const required = min === max ? countLabel(min, unit) : `${min}–${max} ${unit}s`;
    return `This seed has ${countLabel(seed.length, unit)}. The format requires ${required}.`;
  }

  // Validation functions return an empty string for a seed that fits the preset.
  function decimal(seed, min, max, maxDigits = Infinity) {
    if (!seed) return "The seed is empty. Enter a decimal number.";
    const signed = min < 0n;
    const error = characterError(signed ? seed.replace(/^-/, "") : seed, /[^0-9]/u,
      signed ? "digits with an optional leading minus sign" : "decimal digits (0–9)");
    if (error) return error;
    if (seed === "-") return "The minus sign needs at least one digit after it.";
    if (seed.length > maxDigits) return `This seed has ${seed.length} digits. The format allows ${maxDigits}.`;
    const number = BigInt(seed);
    if (number >= min && number <= max) return "";
    const actual = seed.length > 28 ? `The ${seed.length - Number(seed.startsWith("-"))}-digit value` : String(number);
    return number < min ? `${actual} is below the minimum seed of ${min}.` : `${actual} exceeds the maximum seed of ${max}.`;
  }

  function unsigned32(seed) {
    return decimal(seed, 0n, U32_MAX);
  }

  const METHODS = {
    mtap: {
      label: "Multi-tap (0 separators)",
      ignoresCase: true,
      ignored: nonMultiTap,
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
      ignored: nonLetters,
      encode: encodePair,
      decode: decodePair,
      rule: "Write the phone key and the 1-based tap count for each letter. Decode consumes two digits per letter. For example, 23 is the third letter on key 2, C."
    },
    fixed: {
      label: "A1Z26 (fixed)",
      ignoresCase: true,
      ignored: nonLetters,
      encode: (text) => encodeAlphabet(text, ""),
      decode: decodeAlphabetFixed,
      rule: "Write the letter’s 1-based alphabet position as two decimal digits, from A = 01 to Z = 26. Decode reads two digits at a time."
    },
    separated: {
      label: "A1Z26 (dashes)",
      ignoresCase: true,
      ignored: nonLetters,
      usesSeparators: true,
      encode: (text) => encodeAlphabet(text, "-"),
      decode: decodeAlphabetSeparated,
      rule: "Write each 1-based alphabet position in decimal and join with dashes. Decode accepts dashes, whitespace, or commas between positions."
    },
    base36: {
      label: "Base 36 → decimal",
      ignoresCase: true,
      ignored: nonBase36,
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

  const FAMILIES = {
    literal: { label: "As typed", variants: ["literal"] },
    keypad: { label: "Phone keypad", variants: ["mtap", "pair"] },
    alphabet: { label: "A1Z26", variants: ["fixed", "separated"] },
    base36: { label: METHODS.base36.label, variants: ["base36"] },
    transforms: {
      label: "Character transforms",
      variants: ["upperLookalikes", "lowerLookalikes", "flipCase", "reverse", "rotate", "reverseLookalikes"]
    },
    packed: { label: "Packed text" }
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
    lego: { label: "LEGO Fortnite", validate: (seed) => decimal(seed, 1n, LEGO_MAX, 10), numeric: true },
    midjourney: { label: "Midjourney", validate: unsigned32, numeric: true },
    minecraft: { label: "Minecraft (numeric)", validate: (seed) => decimal(seed, I64_MIN, I64_MAX) },
    terraria: {
      label: "Terraria", allowsSeparators: true,
      validate: (seed) => seed.trim() ? "" : "This seed is blank after trimming whitespace. Terraria requires text or a number."
    },
    isaac: { label: "Binding of Isaac", validate: packedSeeds.isaacSeedError, allowsLetters: true },
    sts: {
      label: "Slay the Spire", allowsLetters: true,
      validate(seed) {
        const code = seed.replace(/\s+/g, "").toUpperCase();
        const error = characterError(code, /[^A-Z0-9]/u, "letters A–Z and digits 0–9");
        if (error || (code.length >= 8 && code.length <= 16)) return error;
        return `This seed has ${countLabel(code.length, "character")} after removing whitespace and uppercasing. Slay the Spire requires 8–16.`;
      }
    },
    spelunky2: {
      label: "Spelunky 2",
      validate: (seed) => characterError(seed, /[^0-9A-F]/iu, "hexadecimal digits (0–9, A–F)")
        || sizeError(seed, 8, 8, "digit"),
      allowsLetters: true
    },
    deadcells: {
      label: "Dead Cells",
      validate: (seed) => characterError(seed, /[^0-9]/u, "decimal digits (0–9)") || sizeError(seed, 6, 6, "digit"),
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

  function translationError(game, id, keyword, seed, stored, reading) {
    const method = METHODS[id];
    const decoded = reading ? `Decode reads ${quotePreview(reading)}.` : "Decode finds no keyword with this method.";
    if (!seed) {
      if (method.reversible) return `${method.label} leaves ${quotePreview(keyword)} unchanged.`;
      if (id === "mtap") {
        const kept = normalize(keyword, method.ignored);
        return kept ? `Multi-tap turns ${quotePreview(kept)} into zeros and drops them from the front.`
          : `Multi-tap needs a letter A–Z, a digit, or a space. It skipped ${quotePreview(keyword)}.`;
      }
      const alphabet = id === "base36" ? "a letter A–Z or a digit 0–9" : "a letter A–Z";
      return `${method.label} needs ${alphabet}. It skipped ${quotePreview(keyword)}.`;
    }
    const skipped = method?.ignored && keyword.match(method.ignored)?.[0];
    if (skipped) return `${method.label} skips ${quotePreview(skipped)}. ${decoded}`;
    if (id === "base36") {
      const count = keyword.length - reading.length;
      return `Converting from base 36 drops ${countLabel(count, "leading zero")}. ${decoded}`;
    }
    if (id === "mtap") {
      if (/^ /.test(keyword)) return `Multi-tap drops the zeros for leading spaces. ${decoded}`;
      const digit = keyword.match(/\d/)?.[0];
      if (digit) return `Multi-tap reads ${JSON.stringify(digit)} as a phone-key digit. ${decoded}`;
      return `Multi-tap reads zeros as spaces or separators between taps on the same key. ${decoded}`;
    }
    const normalization = stored === seed ? "" : `${PRESETS[game].label} stores ${quotePreview(seed)} as ${quotePreview(stored)}. `;
    return normalization + decoded;
  }

  function valheimReadingConflict(seed, keyword) {
    const packet = packedSeeds.readPacket("valheim", seed);
    if (packet?.status === "decoded") {
      return packet.keyword === keyword ? "" : `The ! prefix makes Decode read ${quotePreview(packet.keyword)} as packed text.`;
    }
    if (packet) return packedSeeds.packetError(packedSeeds.inspect("packet", "valheim", seed));
    return packedSeeds.readLegacy("valheim", seed).olderCode ? "Decode reads this ~ seed as an older hash with no stored keyword." : "";
  }

  function inspectEncodings(game, keyword) {
    const { label: gameName, validate } = PRESETS[game];
    const compatible = new Map(matchingMethods(game));
    const choices = [];
    const failures = [];
    const disabled = new Set();
    for (const [family, { label: familyLabel, variants }] of Object.entries(FAMILIES)) {
      if (!variants) continue;
      if (variants.every((id) => id !== "literal" && !compatible.has(id))) disabled.add(family);
      for (const id of variants) {
        const method = compatible.get(id);
        const label = METHODS[id]?.label ?? familyLabel;
        if (id !== "literal" && !method) {
          const reason = METHODS[id].usesSeparators
            ? `${gameName} rejects dashed seeds and the one-letter A1Z26 codes 1–26.`
            : `${gameName} uses numeric seeds. Flip case requires letters.`;
          failures.push({ id, family, label, reason });
          continue;
        }
        if (!keyword) continue;
        const value = method ? method.encode(keyword) : keyword;
        const formatError = value && validate(value);
        const stored = formatError ? "" : canonicalSeed(game, value);
        const restored = method && stored ? method.decode(methodInput(game, id, stored)) : stored;
        const reason = formatError || (!value || !matchesReading(method, restored, keyword)
          ? translationError(game, id, keyword, value, stored, restored)
          : id !== "literal" && game === "valheim" ? valheimReadingConflict(value, keyword) : "");
        if (reason) failures.push({ id, family, label, reason, attempted: value });
        else choices.push({ id, family, label, value });
      }
    }
    if (!packedSeeds.hasSpace(game)) {
      disabled.add("packed");
      failures.push({ family: "packed", label: FAMILIES.packed.label,
        reason: "Packed text needs the seed limits of a selected game." });
    }
    for (const { number, label, seed, reason } of packedSeeds.encode(game, keyword)) {
      const id = "packed-" + number;
      const error = reason || validate(seed);
      if (error) failures.push({ id, family: "packed", label, reason: error, attempted: seed });
      else choices.push({ id, family: "packed", label, value: seed });
    }
    return { choices, failures, disabled };
  }

  function caseReadings(method, value) {
    if (!method.ignoresCase) return [value];
    const lower = value.toLowerCase();
    const title = lower.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    return [...new Set([value, lower, title])];
  }

  return { KEYMAP, METHODS, FAMILIES, PRESETS, matchingMethods, matchesReading, caseReadings, canonicalSeed,
    methodInput, normalize, translationError, inspectEncodings };
})();

if (typeof module === "object") module.exports = SeedTools;
