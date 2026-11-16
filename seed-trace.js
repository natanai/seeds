"use strict";

const SeedTrace = (() => {
  const quoted = (text) => JSON.stringify(text);
  const byteList = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
  const page = (title, note, rows) => ({ title, note, rows });

  function slotPage(slot, decoding, lane, encoded) {
    const rows = [];
    const input = slot.isaac ? slot.seed.toUpperCase().replace(/\s+/g, "") : slot.seed;
    if (slot.isaac) {
      const { number, mask, check, token } = slot.isaac;
      rows.push(
        ["Isaac run number", slot.index + " + 1 = " + number],
        ["Game checksum", "c = 0; for n = " + number + " while n ≠ 0: " +
          "c = (c + (n & 255)) & 255; c = ((c << 1) | (c >>> 7)) & 255; n >>>= 5. c = " + check],
        ["Packed with game checksum", "((" + number + " XOR 0x" + mask.toString(16) +
          ") << 8) OR " + check + " = " + token]
      );
    }
    if (slot.alphabet) {
      const alphabet = slot.alphabet;
      const digits = [...input.slice(slot.prefix.length)].map((symbol) => alphabet.indexOf(symbol));
      rows.push(
        ["Alphabet in value order", alphabet],
        ["Digits written in base " + alphabet.length, digits.join(", ")],
        ["Positional value", digits.map((digit, i) => digit + "×" + alphabet.length + "^" +
          (digits.length - i - 1)).join(" + ") + " = " + (slot.isaac?.token ?? slot.index)],
        slot.minWidth < slot.width
          ? ["Field width", slot.minWidth + "–" + slot.width + " digits. Encode writes the shortest form."]
          : ["Field width", slot.width + " digits, padded on the left" +
            (slot.prefix ? " after " + quoted(slot.prefix) : "")]
      );
    } else {
      rows.push(
        ["Decimal seed = minimum + game slot", slot.minimum + " + " + slot.index +
          " = " + (slot.minimum + slot.index)],
        ["Allowed range", slot.minimum + " through " + slot.maximum]
      );
      if (slot.width) rows.push(["Decimal width", slot.width + " digits, padded on the left"]);
    }
    if (lane != null) rows.push(["Game slot = 6 × stored packet + lane", "6 × " + encoded + " + " + lane + " = " + slot.index]);
    rows.push(["Seed", quoted(slot.seed)]);
    const note = slot.alphabet
      ? "A digit is the zero-based index in the alphabet. Read left to right using value = base × value + digit. To write, take remainders from right to left."
      : "The game field holds a decimal integer. Subtract the minimum to read the game slot.";
    return page(decoding ? "Read the seed" : "Write the seed", note, rows);
  }

  function hashRows(snapshot, input) {
    return [
      [input, snapshot.text],
      ["UTF-8 bytes (hex)", byteList(snapshot.bytes)],
      ["FNV-1a, 64 bits", "h starts at " + snapshot.start + ". For each byte b, h = ((h XOR b) × " +
        snapshot.prime + ") mod 2⁶⁴."],
      ["Hash h", snapshot.hash]
    ];
  }

  function symbolsPage(text, keyword, decoding) {
    const { mode, digits, ordered, backward } = text;
    let note;
    let mappings;
    if (mode === "words") {
      note = "Split at single ASCII spaces. A digit is 3 × the zero-based dictionary index plus case " +
        "(0 lowercase, 1 initial capital, 2 uppercase). Divide by 3 and use the remainder to read it.";
      mappings = ordered.split(" ").map((word, i) => quoted(word) + " ↔ 3 × " +
        Math.floor(digits[i] / 3) + " + " + (digits[i] % 3) + " = " + digits[i]).join("\n");
    } else if (mode === "letters") {
      note = "Map each character to its zero-based alphabet index. Space is 0, a is 1, and z is 26.";
      mappings = digits.map((digit) => (digit === 0 ? "␠" : text.alphabet[digit]) + " ↔ " + digit).join("   ");
    } else {
      note = "Read the ordered text as UTF-8. Each byte, 0 through 255, is one digit. Decode reads those bytes as UTF-8.";
      const encoder = new TextEncoder();
      mappings = [...ordered].map((symbol) => quoted(symbol) + " ↔ " + byteList(encoder.encode(symbol))).join("   ");
    }
    const rows = [
      [decoding ? "Text before restoring order" : "Keyword", quoted(decoding ? ordered : keyword)],
      [decoding ? "Keyword" : "Text in stored order", quoted(decoding ? keyword : ordered)],
      ["Order", backward ? (mode === "words" ? "Reverse the words" : "Reverse the Unicode code points") : "Keep the order"]
    ];
    if (text.words) rows.push(["Dictionary", text.words + " words in source order, three cases per entry"]);
    if (text.alphabet) rows.push(["Alphabet", quoted(text.alphabet)]);
    rows.push([mode === "text" ? "Character ↔ bytes (hex)" : "Symbol ↔ digit", mappings]);
    return page(decoding ? "Restore the keyword" : "Map the keyword", note, rows);
  }

  function rankPage(text, decoding) {
    const calculation = decoding ? text.steps.map(({ index, digit, quotient }) =>
      "(" + index + " − 1) ÷ " + text.radix + " = " + quotient + " rem " + digit)
      : [...text.steps].reverse().map(({ index, digit, quotient }) =>
        quotient + " × " + text.radix + " + " + (digit + 1) + " = " + index);
    return page(decoding ? "Unpack the text digits" : "Pack the text digits", decoding
      ? "While rank is positive, subtract 1, take the remainder on division by the radix, and keep the integer quotient as the next rank. Reverse the collected digits."
      : "Starting at 0, multiply by the radix and add the digit plus 1. Adding 1 preserves leading zero digits and the length.",
    [
      ["Radix", text.radix],
      ["Digits", text.digits.join(", ")],
      ["Rank", text.position],
      [decoding ? "Division from right to left" : "Accumulation from left to right", calculation.join("\n")]
    ]);
  }

  function packedPages({ slot, text, keyword }, decoding) {
    const format = slotPage(slot, decoding);
    format.rows.unshift(decoding
      ? ["Text rank = game slot + 1", slot.index + " + 1 = " + text.position]
      : ["Game slot = text rank − 1", text.position + " − 1 = " + slot.index]);
    const symbols = symbolsPage(text, keyword, decoding);
    const rank = rankPage(text, decoding);
    return decoding ? [format, rank, symbols] : [symbols, rank, format];
  }

  function packetPages(trace, decoding) {
    const { slot, lane, capacity, checks, raw, position, number, recipeCount, packet,
      check, expected, limit, text, checkHash } = trace;
    const format = slotPage(slot, decoding, lane, packet);
    const checkPage = page(decoding ? "Read and verify the check" : "Append the check",
      "Integer division by the check modulus recovers the raw number. The remainder is the check.", [
        ["Check modulus", checks],
        ...(checkHash ? hashRows(checkHash, 'FNV input = JSON.stringify([game, decimal raw as text, ""])') : []),
        ["Check = hash mod modulus", expected === null ? "Rank " + position + " exceeds " + limit : checkHash.hash + " mod " + checks + " = " + expected],
        ["Packet = raw × modulus + check", raw + " × " + checks + " + " + check + " = " + packet],
        ...(decoding ? [["Check in the seed", check === expected ? check + " (matches)" : check + " (fails)"]] : [])
      ]);
    if (!text) return [page("Keyword unavailable", PackedText.packetError(trace), []), format, checkPage];
    const recipe = page("Recipe number", decoding
      ? "The raw number gives one recipe from its remainder and one text rank from its integer quotient plus 1."
      : "Multiply the zero-based rank by the number of recipes and add the recipe ID. Different recipes occupy different remainders.", [
        ["Recipe ID = raw mod " + recipeCount, raw + " mod " + recipeCount + " = " + number + " (" + text.label + ")"],
        ["Rank = floor(raw ÷ " + recipeCount + ") + 1", position],
        ["Raw = (rank − 1) × " + recipeCount + " + recipe ID", "(" + position + " − 1) × " +
          recipeCount + " + " + number + " = " + raw],
        ["Largest rank that fits", "floor(" + capacity + " ÷ (" + recipeCount + " × " + checks + ")) = " + limit]
      ]);
    const symbols = symbolsPage(text, trace.keyword, decoding);
    const rank = rankPage(text, decoding);
    const certainty = page("Exact recovery", "Each packed seed stores one recipe ID and one text rank. " +
      "Different recipes, including both orders, can store the same keyword. The order in the recipe tells Decode which way to read.", [
        ["Recover", quoted(trace.keyword)],
        ["Check limit", "A short check can also match an altered seed. " +
          (lane == null ? "Older Valheim seeds used ! to announce this format." : "A game number can also be read as an ordinary number or by another method.")]
      ]);
    return decoding
      ? [format, checkPage, recipe, rank, symbols, certainty]
      : [symbols, rank, recipe, checkPage, format, certainty];
  }

  function legacyPages(trace) {
    const { slot, lane, slots, weights, variant, offset, original, text } = trace;
    const format = slotPage(slot, true);
    if (lane === 0n) return [format, page("Older hash", "The older encoder stored a reduced FNV-1a hash and a variant offset in this lane. The text digits are unavailable.", [
      ["Lane = game slot mod 3", slot.index + " mod 3 = " + lane],
      ["Game slot", "3 × ((FNV-1a(UTF-8(keyword)) + offset) mod " + slots + ")"],
      ["Variant weights per thousand", weights.join(", ")]
    ])];
    if (!text) return [format];
    return [format, page("Older packed text variation",
      "This format stores the digit alphabet in its lane and leaves the chosen offset unstated. Decode tries all eight offsets.", [
        ["Lane = game slot mod 3", slot.index + " mod 3 = " + lane],
        ["Slots in this lane", "floor((" + slot.capacity + " + 2 − " + lane + ") ÷ 3) = " + slots],
        ["Offset for variation " + (variant + 1), "floor(" + slots + " × " + weights[variant] + " ÷ 1000) = " + offset],
        ["Base slot = ((floor(game slot ÷ 3) + slots − offset) mod slots) × 3 + lane", original],
        ["Rank = floor(base slot ÷ 3) + 1", text.position]
      ]), rankPage(text, true), symbolsPage(text, trace.keyword, true)];
  }

  function direct(id, keyword, seed, decoding, game) {
    const method = SeedTools.METHODS[id];
    let rule = method?.rule ?? "The seed is the keyword as typed, with the same characters and order.";
    const source = decoding ? seed : keyword;
    const result = decoding ? keyword : seed;
    const rows = [[decoding ? "Seed" : "Keyword", quoted(source)]];
    const decimal = SeedTools.canonicalSeed(game, seed);
    const readSeed = SeedTools.methodInput(game, id, decoding ? seed : decimal);
    if (decoding && readSeed !== seed) {
      rows.push(["Digits in two-character groups", quoted(readSeed)]);
      rule += " Decimal game seeds can omit a leading zero. An odd digit count restores that zero before pairing.";
    } else if (!decoding && decimal !== seed) {
      rows.push(["Game’s decimal form", quoted(decimal)]);
    }
    if (method && !method.reversible) {
      const letters = SeedTools.normalize(keyword, method.ignored);
      if (!decoding) rows.push(["After ASCII filtering and uppercasing", quoted(letters)]);
      if (id === "mtap" || id === "pair") {
        rows.push(["Keys", Object.entries(SeedTools.KEYMAP).map(([key, letters]) => key + " " + letters).join("   ")]);
      }
      if (id === "mtap") {
        rows.push(["Digit run ↔ reading", method.runs(readSeed).map(([run, reading]) => run + " ↔ " + reading).join("   ")]);
      }
      if (id === "base36") {
        rows.push(["Values of the base 36 digits", [...letters].map((digit) => parseInt(digit, 36)).join(", ")]);
      } else if (id !== "mtap") {
        rows.push(["Character ↔ code", [...letters].map((letter) => letter + " ↔ " + method.encode(letter)).join("   ")]);
      }
      const canonical = method.ignoresCase ? method.decode(readSeed) : "";
      if (/[A-Z]/.test(canonical)) {
        rule += " Either case gives the same code. Each bracket shows the cases that Decode can read at that position.";
        rows.push(["Possible casing", canonical.replace(/[A-Z]/g, (letter) => "[" + letter + letter.toLowerCase() + "]")]);
      }
    }
    if (id === "reverseLookalikes") {
      const swap = SeedTools.METHODS.upperLookalikes;
      rows.push(["Before reversing", quoted(swap.encode(source) || source)]);
    }
    rows.push([decoding ? "Keyword" : "Seed", quoted(result)]);
    return [page(method?.label ?? "As typed", rule, rows)];
  }

  return { packedPages, packetPages, legacyPages, direct, page };
})();
