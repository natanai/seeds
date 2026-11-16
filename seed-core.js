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
  const nonMultiTap = /[^A-Za-z ]+/g;
  const normalize = (text, ignored) => text.replace(ignored, "").toUpperCase();
  const tapCodes = Object.fromEntries(Object.entries(letterKeys)
    .map(([letter, [key, taps]]) => [letter, key.repeat(taps)]));
  tapCodes[" "] = "0";
  const alphabetCodes = Object.fromEntries(Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    (letter, index) => [letter, String(index + 1)]));

  function digitReadings(seed, symbols, widths) {
    if (!digits.test(seed)) return null;
    // Count complete readings at each offset so a page can skip whole branches.
    const counts = new Array(seed.length + 1).fill(0n);
    counts[seed.length] = 1n;
    for (let offset = seed.length - 1; offset >= 0; offset--) {
      for (const width of widths) {
        const end = offset + width;
        if (end <= seed.length && symbols.has(seed.slice(offset, end))) counts[offset] += counts[end];
      }
    }
    return {
      count: counts[0],
      at(index) {
        if (index < 0n || index >= counts[0]) return undefined;
        let text = "";
        let offset = 0;
        while (offset < seed.length) {
          for (const width of widths) {
            const end = offset + width;
            if (end > seed.length) continue;
            const symbol = symbols.get(seed.slice(offset, end));
            if (symbol === undefined) continue;
            if (index < counts[end]) {
              text += symbol;
              offset = end;
              break;
            }
            index -= counts[end];
          }
        }
        return text;
      }
    };
  }

  function digitMethod(label, codes, ignored, rule) {
    const symbols = new Map(Object.entries(codes).map(([letter, code]) => [code, letter]));
    const widths = [...new Set([...symbols.keys()].map((code) => code.length))].sort((a, b) => b - a);
    return {
      label, ignored, rule, ignoresCase: true,
      encode: (text) => [...normalize(text, ignored)].map((letter) => codes[letter]).join(""),
      readings: (seed) => digitReadings(seed, symbols, widths)
    };
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
    mtap: digitMethod("Multi-tap", tapCodes, nonMultiTap,
      "Write the phone key once per tap and write 0 for each space in the keyword. Decode tries every grouping of the taps."),
    pair: {
      label: "Keypad [key][press]",
      ignoresCase: true,
      ignored: nonLetters,
      encode: encodePair,
      decode: decodePair,
      rule: "Write the phone key and the 1-based tap count for each letter. Decode consumes two digits per letter. For example, 23 is the third letter on key 2, C."
    },
    alphabet: digitMethod("A1Z26", alphabetCodes, nonLetters,
      "Write the alphabet positions side by side, from A = 1 to Z = 26. Decode tries every grouping into those positions."),
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
    alphabet: { label: METHODS.alphabet.label, variants: ["alphabet"] },
    base36: { label: METHODS.base36.label, variants: ["base36"] },
    transforms: {
      label: "Character transforms",
      variants: ["upperLookalikes", "lowerLookalikes", "flipCase", "reverse", "rotate", "reverseLookalikes"]
    },
    packed: { label: "Packed text" }
  };

  const PRESETS = {
    none: { label: "Any format", validate: () => "", allowsLetters: true },
    valheim: {
      label: "Valheim",
      validate: valheimValidity,
      allowsLetters: true,
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
      label: "Terraria", allowsLetters: true,
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

  function matchingMethods(game) {
    return Object.entries(METHODS).filter(([, method]) => !method.requiresLetters || PRESETS[game].allowsLetters);
  }

  function normalizesDecimal(game) {
    return game === "minecraft" || (PRESETS[game].numeric && game !== "deadcells");
  }

  function canonicalSeed(game, seed) {
    return normalizesDecimal(game) && signedInteger.test(seed) ? BigInt(seed).toString() : seed;
  }

  function matchesReading(method, reading, keyword) {
    // Only fold ASCII letter case. Spaces, punctuation, and other characters still have to match.
    const uppercase = (text) => text.replace(/[a-z]/g, (letter) => letter.toUpperCase());
    return reading === keyword || Boolean(method?.ignoresCase && reading !== undefined &&
      uppercase(reading) === uppercase(keyword));
  }

  function translationError(game, id, keyword, seed, stored, reading) {
    const method = METHODS[id];
    const decoded = reading ? `Decode reads ${quotePreview(reading)}.` : "Decode finds no keyword with this method.";
    if (!seed) {
      if (method.reversible) return `${method.label} leaves ${quotePreview(keyword)} unchanged.`;
      const alphabet = { mtap: "a letter A–Z or a space", base36: "a letter A–Z or a digit 0–9" }[id] ?? "a letter A–Z";
      return `${method.label} needs ${alphabet}. It skipped ${quotePreview(keyword)}.`;
    }
    const skipped = method?.ignored && keyword.match(method.ignored)?.[0];
    if (skipped) return `${method.label} skips ${quotePreview(skipped)}. ${decoded}`;
    if (id === "base36") {
      const count = keyword.length - reading.length;
      return `Converting from base 36 drops ${countLabel(count, "leading zero")}. ${decoded}`;
    }
    const normalization = stored === seed ? "" : `${PRESETS[game].label} stores ${quotePreview(seed)} as ${quotePreview(stored)}. `;
    if (id === "mtap" && stored !== seed) return normalization + "The leading zeros represent spaces in the keyword.";
    return normalization + decoded;
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
          const reason = `${gameName} uses numeric seeds. Flip case requires letters.`;
          failures.push({ id, family, label, reason });
          continue;
        }
        if (!keyword) continue;
        const value = method ? method.encode(keyword) : keyword;
        const formatError = value && validate(value);
        const stored = formatError ? "" : canonicalSeed(game, value);
        // A valid digit encoding preserves a grouping of the input even when the seed can be read several ways.
        const restored = method?.readings
          ? (stored === value ? normalize(keyword, method.ignored) : "")
          : method && stored ? method.decode(stored) : stored;
        const reason = formatError || (!value || !matchesReading(method, restored, keyword)
          ? translationError(game, id, keyword, value, stored, restored) : "");
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
      else choices.push({ id, family: "packed", label, value: seed, variant: number });
    }
    return { choices, failures, disabled };
  }

  function caseReadings(method, value) {
    if (!method.ignoresCase) return [value];
    const lower = value.toLowerCase();
    const title = lower.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    return [...new Set([value, lower, title])];
  }

  function inspectDecodings(game, seed) {
    const readings = [];
    const alternatives = [];
    const formatError = seed ? PRESETS[game].validate(seed) : "";
    if (seed && !formatError) {
      readings.push({ method: "literal", label: FAMILIES.literal.label, value: seed });
      for (const { number, label, keyword } of packedSeeds.readVariants(game, seed)) {
        readings.push({ kind: "packed", variant: number, label, value: keyword });
      }
    }
    const methods = Object.entries(METHODS);
    methods.sort(([, left], [, right]) => Number(Boolean(right.reversible)) - Number(Boolean(left.reversible)));
    if (seed) {
      for (const [id, method] of methods) {
        if (method.readings) {
          const splits = method.readings(seed);
          if (!splits?.count) continue;
          const at = (index) => ({ method: id, label: method.label, value: splits.at(index).toLowerCase() });
          readings.push(at(0n));
          if (splits.count > 1n) alternatives.push({ count: splits.count - 1n, at: (index) => at(index + 1n) });
          continue;
        }
        const decoded = method.decode(seed);
        if (!decoded) continue;
        for (const value of caseReadings(method, decoded)) readings.push({ method: id, label: method.label, value });
      }
    }
    const groups = [{ count: BigInt(readings.length), at: (index) => readings[Number(index)] }, ...alternatives];
    return {
      formatError,
      count: groups.reduce((count, group) => count + group.count, 0n),
      at(index) {
        if (index < 0n) return undefined;
        for (const group of groups) {
          if (index < group.count) return group.at(index);
          index -= group.count;
        }
      }
    };
  }

  return { KEYMAP, METHODS, FAMILIES, PRESETS, matchingMethods, matchesReading, caseReadings, canonicalSeed,
    normalize, translationError, inspectEncodings, inspectDecodings };
})();

if (typeof module === "object") module.exports = SeedTools;
