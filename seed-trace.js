"use strict";

const SeedTrace = (() => {
  const quoted = (text) => JSON.stringify(text);
  const byteList = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
  const page = (title, note, rows) => ({ title, note, rows });

  function slotPage(slot, decoding) {
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
      const digits = [...input].map((symbol) => alphabet.indexOf(symbol));
      rows.push(
        ["Alphabet in value order", alphabet],
        ["Digits written in base " + alphabet.length, digits.join(", ")],
        ["Positional value", digits.map((digit, i) => digit + "×" + alphabet.length + "^" +
          (digits.length - i - 1)).join(" + ") + " = " + (slot.isaac?.token ?? slot.index)],
        slot.minWidth < slot.width
          ? ["Field width", slot.minWidth + "–" + slot.width + " digits. Encode writes the shortest form."]
          : ["Field width", slot.width + " digits, padded on the left"]
      );
    } else {
      rows.push(
        ["Decimal seed = minimum + game slot", slot.minimum + " + " + slot.index +
          " = " + (slot.minimum + slot.index)],
        ["Allowed range", slot.minimum + " through " + slot.maximum]
      );
      if (slot.width) rows.push(["Decimal width", "At least " + slot.width + " digits, padded on the left"]);
    }
    rows.push(["Seed", quoted(slot.seed)]);
    const note = slot.alphabet
      ? "A digit is the zero-based index in the alphabet. Read left to right using value = base × value + digit. To write, take remainders from right to left."
      : "The game field holds a decimal integer. Subtract the minimum to read the game slot.";
    return page(decoding ? "Read the seed" : "Write the seed", note, rows);
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

  function direct(id, keyword, seed, decoding, game) {
    const method = SeedTools.METHODS[id];
    let rule = method?.rule ?? "The seed is the keyword as typed, with the same characters and order.";
    const source = decoding ? seed : keyword;
    const result = decoding ? keyword : seed;
    const rows = [[decoding ? "Seed" : "Keyword", quoted(source)]];
    const decimal = SeedTools.canonicalSeed(game, seed);
    if (!decoding && decimal !== seed) {
      rows.push(["Game’s decimal form", quoted(decimal)]);
    }
    if (method && !method.reversible) {
      const letters = SeedTools.normalize(keyword, method.ignored);
      if (!decoding) rows.push(["After ASCII filtering and uppercasing", quoted(letters)]);
      if (id === "mtap" || id === "pair") {
        rows.push(["Keys", Object.entries(SeedTools.KEYMAP).map(([key, letters]) => key + " " + letters).join("   ")]);
      }
      if (id === "base36") {
        rows.push(["Values of the base 36 digits", [...letters].map((digit) => parseInt(digit, 36)).join(", ")]);
      } else {
        rows.push(["Character ↔ code", [...letters].map((letter) => (letter === " " ? "␠" : letter) +
          " ↔ " + method.encode(letter)).join("   ")]);
      }
      const canonical = method.readings ? letters : method.decode(decoding ? seed : decimal);
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

  return { packedPages, direct, page };
})();
