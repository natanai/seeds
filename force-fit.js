"use strict";

const ForceFit = (() => {
  const LOWERCASE = " abcdefghijklmnopqrstuvwxyz";
  const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const HEX = "0123456789ABCDEF";
  const ISAAC = "ABCDEFGHJKLMNPQRSTWXYZ01234V6789";
  const ISAAC_MASK = 0x0fef7ffdn;
  const U32_MAX = 4294967295n;
  const HASH_START = 14695981039346656037n;
  const HASH_PRIME = 1099511628211n;
  // Fractions of the game's available slots. Keep these stable for existing seeds.
  const OFFSETS = [0n, 618n, 236n, 854n, 472n, 90n, 708n, 326n];
  // Both the word positions and the list length are encoded. Preserve this list for existing seeds.
  const wordList = `
    loving kindness cozy home love quiet road moss forest green river night light morning soft
    gentle peace open world warm heart blue sky wild deep dark wind fire water earth stone rest
    trust hope joy care calm safe freedom space time together alone belonging understanding listen
    listening play beauty grace mutuality respect honesty patience compassion courage a an the and
    or of to in on at for from with by near far over under between around through i you we they he
    she it my your our their me us this that these those is are be am was were have has had do did
    does can could will would may might if when then where who why how all some any each every few
    many more most good better best new old young big small long short tall wide high low little
    large great early late last first next after before one two three four five six seven eight
    nine ten no yes not up down out back left right go get give take make keep carry hold let walk
    run stand sit fall rise see look find hear know think feel want need like remember learn tell
    say come stay live grow build house cabin cottage castle tower wall gate garden farm field
    meadow valley hill hillside mountain mountains coast shore lake woods woodland path trail
    bridge island marsh swamp ocean sea beach sand snow ice frost rain storm thunder cloud fog
    mist sun moon stars spring summer autumn winter dawn dusk sunset twilight midnight day evening
    shadow golden gold silver red brown gray grey white black pink orange purple yellow emerald
    amber crimson pale bright dim copper iron wood ash oak pine birch willow fern grass flower
    flowers leaf leaves roots seed seeds worlds map dream dreams rivers stream creek brook
    waterfall pond pool harbor bay boat sail ship port passage passageways voyage journey
    adventure roam wander lost found hidden secret memory letter letters word words story song
    music sound silence echo raven wolf wolves bear fox cat cats dog deer owl hare bird birds fish
    eagle dragon dragons sheep horse bees bee honey milk bread drink tea coffee hearth candle
    lantern shelter refuge haven oasis grove orchard harvest village settlement town fortress
    guard keeper scout ranger viking nord north south east west northern southern misty windy
    snowy sunny rainy stormy rocky sandy grassy peaceful peacefulness happy sad fierce brave eager
    tender beloved kind kindnesses warmth cold cool alive whole enough lightness wonder wonderland
    serenity solitude contentment generous gratitude empathy curious curiosity playful renewal
    renew purpose choice balance connection communion unity healing strength ease clarity truth
    integrity fairness equality autonomy dignity forgiving mercy acceptance presence self people
    friend friends friendship family partner children child kin community welcome softest freely
    mindful meadowland quietude harmony reciprocity fun wildflower moonlight sunlight starlight
    camp campsite campfire homestead wooded cavern cave caves tunnel underground crystal quartz
    gem gems stonework forge sword bow axe shield armor battle wildness restless restful
  `.trim().split(/\s+/);
  const wordNumber = new Map(wordList.map((word, index) => [word, index]));
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

  function alphabetSpace(alphabet, width, prefix) {
    return {
      alphabet, width, prefix,
      capacity: BigInt(alphabet.length) ** BigInt(width),
      write: (index) => prefix + writeDigits(index, alphabet, width),
      read(seed) {
        if (seed.length !== width + prefix.length || !seed.startsWith(prefix)) return null;
        return readDigits(seed.slice(prefix.length), alphabet);
      }
    };
  }

  function decimalSpace(minimum, maximum, width = 0) {
    return {
      minimum, maximum, width,
      capacity: maximum - minimum + 1n,
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
    valheim: alphabetSpace(BASE62, 9, "~"),
    "going-medieval": unsigned32,
    lego: positive31,
    midjourney: unsigned32,
    minecraft: decimalSpace(-9223372036854775808n, 9223372036854775807n),
    terraria: decimalSpace(0n, 2147483647n),
    isaac: {
      alphabet: ISAAC, width: 8, prefix: "",
      capacity: U32_MAX,
      write(index) {
        const number = index + 1n;
        return writeDigits(((number ^ ISAAC_MASK) << 8n) | isaacChecksum(number), ISAAC, 8);
      },
      read(seed) {
        const digits = seed.toUpperCase().replace(/\s+/g, "");
        if (digits.length !== 8) return null;
        const token = readDigits(digits, ISAAC);
        if (token === null) return null;
        const number = (token >> 8n) ^ ISAAC_MASK;
        return isaacChecksum(number) === (token & 255n) ? number - 1n : null;
      }
    },
    sts: decimalSpace(0n, 999999999999n, 12),
    spelunky2: alphabetSpace(HEX, 8, ""),
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

  function unrank(index, radix, steps) {
    const digits = [];
    while (index > 0n) {
      const digit = Number((index - 1n) % radix);
      const quotient = (index - 1n) / radix;
      steps?.push({ index, digit, quotient });
      digits.push(digit);
      index = quotient;
    }
    return digits.reverse();
  }

  function hash64(bytes) {
    let hash = HASH_START;
    for (const byte of bytes) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * HASH_PRIME);
    }
    return hash;
  }

  function hashText(text, trace, field) {
    const bytes = encoder.encode(text);
    const hash = hash64(bytes);
    if (trace) trace[field] = { text, bytes, hash, start: HASH_START, prime: HASH_PRIME };
    return hash;
  }

  function slotDetails(game, space, index, seed) {
    const { alphabet, minimum, maximum, width, prefix, capacity } = space;
    const slot = { alphabet, minimum, maximum, width, prefix, capacity, index, seed };
    if (game === "isaac") {
      const number = index + 1n;
      const check = isaacChecksum(number);
      slot.isaac = { number, mask: ISAAC_MASK, check, token: ((number ^ ISAAC_MASK) << 8n) | check };
    }
    return slot;
  }

  function legacyIndex(game, keyword) {
    const space = spaces[game];
    const compact = rank(keyword, 27n, (character) => LOWERCASE.indexOf(character),
      (space.capacity + 1n) / 3n);
    if (compact !== null) return (compact - 1n) * 3n + 1n;

    const bytes = encoder.encode(keyword);
    const full = rank(bytes, 256n, (byte) => byte, space.capacity / 3n);
    return full !== null && decoder.decode(bytes) === keyword ? (full - 1n) * 3n + 2n : null;
  }

  function seedIndex(game, seed) {
    if (!hasSpace(game)) return null;
    const space = spaces[game];
    const index = space.read(seed);
    return index !== null && index >= 0n && index < space.capacity ? index : null;
  }

  function decodeLegacySlot(game, index) {
    const tag = index % 3n;
    const digits = unrank(index / 3n + 1n, tag === 1n ? 27n : 256n);
    let keyword;
    try {
      keyword = tag === 1n
        ? digits.map((digit) => LOWERCASE[digit]).join("")
        : decoder.decode(Uint8Array.from(digits));
    } catch {
      return null;
    }
    return legacyIndex(game, keyword) === index ? keyword : null;
  }

  function readLegacy(game, seed, trace) {
    const index = seedIndex(game, seed);
    if (index === null) return { readings: [] };
    const lane = index % 3n;
    const slots = (spaces[game].capacity + 2n - lane) / 3n;
    if (trace) Object.assign(trace, { lane, slots, weights: OFFSETS,
      slot: slotDetails(game, spaces[game], index, seed) });
    if (lane === 0n) return { readings: [], olderCode: game === "valheim" };
    const readings = OFFSETS.flatMap((weight, variant) => {
      const offset = slots * weight / 1000n;
      const original = ((index / 3n + slots - offset) % slots) * 3n + lane;
      const keyword = decodeLegacySlot(game, original);
      if (trace?.variant === variant && keyword) {
        const recipe = { mode: lane === 1n ? "letters" : "text", backward: false };
        Object.assign(trace, { offset, original, keyword, text: textDetails(original / 3n + 1n, recipe) });
      }
      return keyword ? [{ keyword, variant }] : [];
    });
    return { readings };
  }

  const recipes = [
    { mode: "words", backward: false, label: "Words in order" },
    { mode: "words", backward: true, label: "Words backwards" },
    { mode: "letters", backward: false, label: "Letters in order" },
    { mode: "letters", backward: true, label: "Letters backwards" },
    { mode: "text", backward: false, label: "Text in order" },
    { mode: "text", backward: true, label: "Text backwards" }
  ];
  const recipeCount = BigInt(recipes.length);

  function wordDigit(word) {
    const lowercase = word.toLowerCase();
    const number = wordNumber.get(lowercase);
    if (number === undefined) return -1;
    if (word === lowercase) return 3 * number;
    if (word === lowercase[0].toUpperCase() + lowercase.slice(1)) return 3 * number + 1;
    return word === lowercase.toUpperCase() ? 3 * number + 2 : -1;
  }

  function textWord(digit) {
    const word = wordList[Math.floor(digit / 3)];
    if (digit % 3 === 1) return word[0].toUpperCase() + word.slice(1);
    return digit % 3 === 2 ? word.toUpperCase() : word;
  }

  function rankedText(keyword, recipe, limit) {
    if (recipe.mode === "words") {
      const words = keyword.split(" ");
      if (recipe.backward) words.reverse();
      return rank(words, BigInt(3 * wordList.length), wordDigit, limit);
    }
    const text = recipe.backward ? [...keyword].reverse().join("") : keyword;
    if (recipe.mode === "letters") return rank(text, 27n, (symbol) => LOWERCASE.indexOf(symbol), limit);
    const bytes = encoder.encode(text);
    return decoder.decode(bytes) === text ? rank(bytes, 256n, (byte) => byte, limit) : null;
  }

  function readRank(index, recipe) {
    if (recipe.mode === "words") {
      const words = unrank(index, BigInt(3 * wordList.length)).map(textWord);
      if (recipe.backward) words.reverse();
      return words.join(" ");
    }
    const text = recipe.mode === "letters"
      ? unrank(index, 27n).map((digit) => LOWERCASE[digit]).join("")
      : decoder.decode(Uint8Array.from(unrank(index, 256n)));
    return recipe.backward ? [...text].reverse().join("") : text;
  }

  function textDetails(position, recipe) {
    const { mode } = recipe;
    const radix = mode === "words" ? BigInt(3 * wordList.length) : mode === "letters" ? 27n : 256n;
    const steps = [];
    const digits = unrank(position, radix, steps);
    const ordered = readRank(position, { ...recipe, backward: false });
    return { ...recipe, radix, digits, steps, ordered, position, alphabet: mode === "letters" ? LOWERCASE : undefined,
      words: mode === "words" ? wordList.length : undefined };
  }

  const valheimPacked = alphabetSpace(BASE62, 9, "!");
  const valheimKeyed = alphabetSpace(BASE62, 9, "+");

  function packetSpace(game, keyed) {
    if (game === "valheim") return keyed ? valheimKeyed : valheimPacked;
    const space = spaces[game];
    // These two positions belonged to the old non-reversible codes. Older packed seeds remain readable.
    const marker = keyed ? 3n : 0n;
    return {
      capacity: (space.capacity + 5n - marker) / 6n,
      write: (index) => space.write(index * 6n + marker),
      read(seed) {
        const index = seedIndex(game, seed);
        return index !== null && index % 6n === marker ? index / 6n : null;
      }
    };
  }

  function keywordCheck(game, raw, key, checks, trace) {
    return hashText(JSON.stringify([game, String(raw), key]), trace, "checkHash") % checks;
  }

  function keyAmount(game, key, capacity, trace) {
    return key ? hashText(JSON.stringify([game, key]), trace, "keyHash") % capacity : 0n;
  }

  function checkCount(game, keyed) {
    if (game === "valheim") return keyed ? 4093n : 127n;
    return keyed ? 127n : 31n;
  }

  function encodeVariants(game, keyword, key = "") {
    if (!hasSpace(game) || !keyword) return [];
    const keyed = Boolean(key);
    const space = packetSpace(game, keyed);
    const checks = checkCount(game, keyed);
    const shift = keyAmount(game, key, space.capacity);
    const limit = space.capacity / (recipeCount * checks);
    return recipes.flatMap((recipe, number) => {
      const position = rankedText(keyword, recipe, limit);
      if (!position) return [];
      const raw = (position - 1n) * recipeCount + BigInt(number);
      const packet = raw * checks + keywordCheck(game, raw, key, checks);
      return [{ ...recipe, number, keyed, seed: space.write((packet + shift) % space.capacity) }];
    });
  }

  function readPacket(game, seed, key = "", trace) {
    if (!hasSpace(game) || !seed) return null;
    const marked = game === "valheim" && /^[!+][0-9A-Za-z]{9}$/.test(seed);
    if (game === "valheim" && !marked) return null;
    const index = game === "valheim" ? 0n : seedIndex(game, seed);
    if (index === null) return null;
    const keyed = game === "valheim" ? seed.startsWith("+") : index % 6n === 3n;
    const space = packetSpace(game, keyed);
    const encoded = space.read(seed);
    if (encoded === null) return null;
    const checks = checkCount(game, keyed);
    const limit = space.capacity / (recipeCount * checks);
    if (trace) Object.assign(trace, {
      keyed, encoded, capacity: space.capacity, checks, recipeCount, limit,
      lane: game === "valheim" ? null : index % 6n,
      slot: game === "valheim" ? slotDetails(game, space, encoded, seed) : slotDetails(game, spaces[game], index, seed)
    });
    if (keyed && !key) return marked ? { status: "key-needed" } : null;
    const usedKey = keyed ? key : "";
    const shift = keyAmount(game, usedKey, space.capacity, trace);
    const packet = (encoded + space.capacity - shift) % space.capacity;
    const raw = packet / checks;
    const position = raw / recipeCount + 1n;
    const number = Number(raw % recipeCount);
    const recipe = recipes[number];
    const check = packet % checks;
    const expected = position <= limit ? keywordCheck(game, raw, usedKey, checks, trace) : null;
    if (trace) Object.assign(trace, { usedKey, shift, packet, raw, position, number, check, expected });
    if (check === expected) {
      try {
        const keyword = readRank(position, recipe);
        if (trace) Object.assign(trace, { keyword, text: textDetails(position, recipe) });
        return { status: "decoded", keyword, keyed, ...recipe };
      } catch {
        // An unrelated seed can resemble a packet without containing readable text.
      }
    }
    return marked ? { status: keyed ? "key-mismatch" : "copy-check" } : null;
  }

  const valheimRecovery = alphabetSpace(BASE62, 9, "*");
  const recoveryKey = /^r1\.([a-z0-9-]+)\.([0-7])\.([A-Za-z0-9_-]*)$/;

  function recoveryGame(key) {
    const game = recoveryKey.exec(key)?.[1];
    return hasSpace(game) ? game : null;
  }

  function needsRecovery(game, seed) {
    return game === "valheim" && valheimRecovery.read(seed) !== null;
  }

  // The seed keeps the first byte and a fingerprint of all the text. The key keeps the rest.
  function recoveryIndex(fingerprint, firstByte, variant, capacity) {
    const slots = capacity / 256n;
    const offset = slots * OFFSETS[variant] / 1000n;
    return (fingerprint + offset) % slots * 256n + BigInt(firstByte);
  }

  function encodeRecovery(game, keyword) {
    if (!hasSpace(game) || !keyword) return [];
    const space = game === "valheim" ? valheimRecovery : spaces[game];
    const text = JSON.stringify(keyword).slice(1, -1);
    const bytes = encoder.encode(text);
    const fingerprint = hash64(encoder.encode(game + "." + text));
    let tail = "";
    for (let i = 1; i < bytes.length; i++) tail += String.fromCharCode(bytes[i]);
    const token = btoa(tail).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return OFFSETS.map((_, variant) => {
      const index = recoveryIndex(fingerprint, bytes[0], variant, space.capacity);
      return { seed: space.write(index), key: "r1." + game + "." + variant + "." + token };
    });
  }

  function readRecovery(seed, key, trace) {
    const match = recoveryKey.exec(key);
    if (!match || !hasSpace(match[1])) return null;
    const [, game, variant, token] = match;
    const space = game === "valheim" ? valheimRecovery : spaces[game];
    const index = space.read(seed);
    if (index === null || index < 0n || index >= space.capacity) return null;
    if (trace) Object.assign(trace, { slot: slotDetails(game, space, index, seed), variant: Number(variant), token, key });
    try {
      const tail = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = new Uint8Array(tail.length + 1);
      bytes[0] = Number(index % 256n);
      for (let i = 0; i < tail.length; i++) bytes[i + 1] = tail.charCodeAt(i);
      const text = decoder.decode(bytes);
      const keyword = JSON.parse('"' + text + '"');
      const fingerprint = hashText(game + "." + text, trace, "fingerprint");
      const expected = recoveryIndex(fingerprint, bytes[0], Number(variant), space.capacity);
      const valid = keyword && JSON.stringify(keyword).slice(1, -1) === text && expected === index;
      if (trace) Object.assign(trace, { text, bytes, expected,
        weight: OFFSETS[Number(variant)], keyword: valid ? keyword : null });
      return valid ? keyword : null;
    } catch {
      return null;
    }
  }

  function validIsaacSeed(seed) {
    return seedIndex("isaac", seed) !== null;
  }

  function inspect(kind, game, seed, key = "", variant) {
    const trace = { kind, game, variant };
    if (kind === "packet") readPacket(game, seed, key, trace);
    if (kind === "legacy") readLegacy(game, seed, trace);
    if (kind === "recovery") {
      readRecovery(seed, key, trace);
      if (!trace.slot && needsRecovery(game, seed)) {
        trace.slot = slotDetails(game, valheimRecovery, valheimRecovery.read(seed), seed);
      }
    }
    return trace.slot ? trace : null;
  }

  return {
    hasSpace, encodeVariants, readPacket, readLegacy, validIsaacSeed,
    encodeRecovery, readRecovery, recoveryGame, needsRecovery, inspect
  };
})();

if (typeof module === "object") module.exports = ForceFit;
