"use strict";

const ForceFit = (() => {
  const LOWERCASE = " abcdefghijklmnopqrstuvwxyz";
  const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const HEX = "0123456789ABCDEF";
  const ISAAC = "ABCDEFGHJKLMNPQRSTWXYZ01234V6789";
  const U32_MAX = 4294967295n;
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
      capacity: U32_MAX,
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

  function readLegacy(game, seed) {
    const index = seedIndex(game, seed);
    if (index === null) return { readings: [] };
    const lane = index % 3n;
    if (lane === 0n) return { readings: [], olderCode: game === "valheim" };
    const slots = (spaces[game].capacity + 2n - lane) / 3n;
    const readings = OFFSETS.flatMap((weight, variant) => {
      const offset = slots * weight / 1000n;
      const original = ((index / 3n + slots - offset) % slots) * 3n + lane;
      const keyword = decodeLegacySlot(game, original);
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

  function keywordCheck(game, raw, key, checks) {
    return hash64(encoder.encode(JSON.stringify([game, String(raw), key]))) % checks;
  }

  function keyAmount(game, key, capacity) {
    return key ? hash64(encoder.encode(JSON.stringify([game, key]))) % capacity : 0n;
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

  function readPacket(game, seed, key = "") {
    if (!hasSpace(game) || !seed) return null;
    const marked = game === "valheim" && /^[!+][0-9A-Za-z]{9}$/.test(seed);
    if (game === "valheim" && !marked) return null;
    const index = game === "valheim" ? 0n : seedIndex(game, seed);
    if (index === null) return null;
    const keyed = game === "valheim" ? seed.startsWith("+") : index % 6n === 3n;
    const space = packetSpace(game, keyed);
    const encoded = space.read(seed);
    if (encoded === null) return null;
    if (keyed && !key) return marked ? { status: "key-needed" } : null;
    const usedKey = keyed ? key : "";
    const checks = checkCount(game, keyed);
    const packet = (encoded + space.capacity - keyAmount(game, usedKey, space.capacity)) % space.capacity;
    const raw = packet / checks;
    const position = raw / recipeCount + 1n;
    const number = Number(raw % recipeCount);
    const recipe = recipes[number];
    if (position <= space.capacity / (recipeCount * checks) &&
        packet % checks === keywordCheck(game, raw, usedKey, checks)) {
      try {
        const keyword = readRank(position, recipe);
        return { status: "decoded", keyword, keyed, ...recipe };
      } catch {
        // An unrelated seed can resemble a packet without containing readable text.
      }
    }
    return marked ? { status: keyed ? "key-mismatch" : "copy-check" } : null;
  }

  function validIsaacSeed(seed) {
    return seedIndex("isaac", seed) !== null;
  }

  return { hasSpace, encodeVariants, readPacket, readLegacy, validIsaacSeed };
})();

if (typeof module === "object") module.exports = ForceFit;
