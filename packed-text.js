"use strict";

const PackedText = (() => {
  const LOWERCASE = " abcdefghijklmnopqrstuvwxyz";
  const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const HEX = "0123456789ABCDEF";
  const ISAAC = "ABCDEFGHJKLMNPQRSTWXYZ01234V6789";
  const ISAAC_MASK = 0x0fef7ffdn;
  const U32_MAX = 4294967295n;
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
    do {
      text = alphabet[Number(index % base)] + text;
      index /= base;
    } while (index > 0n || text.length < width);
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

  function alphabetSpace(alphabet, width, minWidth = width) {
    return {
      alphabet, width, minWidth,
      capacity: BigInt(alphabet.length) ** BigInt(width),
      write: (index) => writeDigits(index, alphabet, minWidth),
      read(seed) {
        if (seed.length < minWidth || seed.length > width) return null;
        return readDigits(seed, alphabet);
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

  function readIsaac(seed) {
    const code = seed.toUpperCase().replace(/\s+/g, "");
    const character = [...code].find((symbol) => !ISAAC.includes(symbol));
    if (character) return { error: `This seed contains ${JSON.stringify(character)}. Use Isaac’s alphabet ${ISAAC}.` };
    if (code.length !== 8) return { error: `This seed has ${code.length} symbols after removing spaces. Isaac requires 8.` };
    const token = readDigits(code, ISAAC);
    const number = (token >> 8n) ^ ISAAC_MASK;
    const check = token & 255n;
    const expected = isaacChecksum(number);
    if (check !== expected) return { error: `Isaac checksum is ${check}. The seed’s value requires ${expected}.` };
    if (number === 0n) return { error: "This seed encodes 0. Isaac requires a nonzero run seed." };
    return { index: number - 1n };
  }

  const unsigned32 = decimalSpace(0n, U32_MAX);
  const positive31 = decimalSpace(1n, 2147483647n);
  const spaces = {
    valheim: alphabetSpace(BASE62, 10, 1),
    bannerlord: unsigned32,
    "going-medieval": unsigned32,
    lego: positive31,
    midjourney: unsigned32,
    minecraft: decimalSpace(-9223372036854775808n, 9223372036854775807n),
    terraria: decimalSpace(0n, 2147483647n),
    isaac: {
      alphabet: ISAAC, width: 8,
      capacity: U32_MAX,
      write(index) {
        const number = index + 1n;
        return writeDigits(((number ^ ISAAC_MASK) << 8n) | isaacChecksum(number), ISAAC, 8);
      },
      read: (seed) => readIsaac(seed).index ?? null
    },
    sts: decimalSpace(0n, 999999999999n, 8),
    spelunky2: alphabetSpace(HEX, 8),
    deadcells: decimalSpace(0n, 999999n, 6),
    factorio: unsigned32
  };
  function hasSpace(game) {
    return Object.hasOwn(spaces, game);
  }

  function rank(sequence, radix, digitOf, ceiling, failure) {
    let index = 0n;
    let count = 0;
    for (const symbol of sequence) {
      const digit = digitOf(symbol);
      if (digit < 0) {
        if (failure) failure.symbol = symbol;
        return null;
      }
      index = index * radix + BigInt(digit + 1);
      count++;
      if (index > ceiling) {
        if (failure) Object.assign(failure, { index, count });
        return null;
      }
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

  function slotDetails(game, space, index, seed) {
    const { alphabet, minimum, maximum, width, minWidth = width } = space;
    const slot = { alphabet, minimum, maximum, width, minWidth, index, seed };
    if (game === "isaac") {
      const number = index + 1n;
      const check = isaacChecksum(number);
      slot.isaac = { number, mask: ISAAC_MASK, check, token: ((number ^ ISAAC_MASK) << 8n) | check };
    }
    return slot;
  }

  function seedIndex(space, seed) {
    if (typeof space?.read !== "function") return null;
    const index = space.read(seed);
    return index !== null && index >= 0n && index < space.capacity ? index : null;
  }

  const recipes = [
    { mode: "words", backward: false, label: "Dictionary" },
    { mode: "words", backward: true, label: "Dictionary reversed" },
    { mode: "letters", backward: false, label: "Base 27" },
    { mode: "letters", backward: true, label: "Base 27 reversed" },
    { mode: "text", backward: false, label: "UTF-8" },
    { mode: "text", backward: true, label: "UTF-8 reversed" }
  ];

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

  function rankedText(keyword, recipe, limit, failure) {
    if (recipe.mode === "words") {
      const words = keyword.split(" ");
      if (recipe.backward) words.reverse();
      return rank(words, BigInt(3 * wordList.length), wordDigit, limit, failure);
    }
    const text = recipe.backward ? [...keyword].reverse().join("") : keyword;
    if (recipe.mode === "letters") return rank(text, 27n, (symbol) => LOWERCASE.indexOf(symbol), limit, failure);
    const surrogate = keyword.match(/[\uD800-\uDFFF]/u)?.[0];
    if (surrogate) {
      failure.symbol = surrogate;
      return null;
    }
    return rank(encoder.encode(text), 256n, (byte) => byte, limit, failure);
  }

  function packingFailure(mode, { count, index, symbol }, limit) {
    if (index !== undefined) {
      const unit = { words: "word", letters: "character", text: "byte" }[mode];
      return `After ${count} ${unit}${count === 1 ? "" : "s"}, the text needs rank ${index}. The seed holds up to ${limit}.`;
    }
    const value = JSON.stringify(symbol.length > 24 ? symbol.slice(0, 24) + "…" : symbol);
    if (mode === "letters") return `Base 27 uses a–z and space. ${value} has no digit in that alphabet.`;
    if (mode === "text") return `UTF-8 would replace the incomplete Unicode character ${value}.`;
    if (!symbol) return "An extra space creates an empty word. Dictionary packing needs one space between words.";
    if (wordNumber.has(symbol.toLowerCase())) return `Dictionary packing cannot preserve the capitalization in ${value}.`;
    return `${value} has no entry in the packing dictionary.`;
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

  function encode(game, keyword) {
    if (!hasSpace(game) || !keyword) return [];
    const space = spaces[game];
    return recipes.map((recipe, number) => {
      const failure = {};
      const position = rankedText(keyword, recipe, space.capacity, failure);
      if (!position) return { ...recipe, number, reason: packingFailure(recipe.mode, failure, space.capacity) };
      return { ...recipe, number, seed: space.write(position - 1n) };
    });
  }

  function readRecipe(position, recipe) {
    try {
      return readRank(position, recipe);
    } catch {
      // A game value may not be a valid sequence of UTF-8 bytes.
      return null;
    }
  }

  function readVariants(game, seed) {
    const index = seedIndex(spaces[game], seed);
    if (index === null) return [];
    return recipes.flatMap((recipe, number) => {
      const keyword = readRecipe(index + 1n, recipe);
      return keyword === null ? [] : [{ ...recipe, number, keyword }];
    });
  }

  function isaacSeedError(seed) {
    return readIsaac(seed).error ?? "";
  }

  function inspect(game, seed, variant) {
    const space = spaces[game];
    const index = seedIndex(space, seed);
    const recipe = recipes[variant];
    if (index === null || !recipe) return null;
    const keyword = readRecipe(index + 1n, recipe);
    if (keyword === null) return null;
    return { keyword, text: textDetails(index + 1n, recipe), slot: slotDetails(game, space, index, seed) };
  }

  return { hasSpace, encode, readVariants, isaacSeedError, inspect };
})();

if (typeof module === "object") module.exports = PackedText;
