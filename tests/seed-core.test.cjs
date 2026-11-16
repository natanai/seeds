const assert = require("node:assert/strict");
const { test } = require("node:test");
const { METHODS, PRESETS, matchingMethods, matchesReading, caseReadings, canonicalSeed, methodInput } = require("../seed-core.js");
const ForceFit = require("../force-fit.js");
const accepts = (game, seed) => PRESETS[game].validate(seed) === "";

test("the original encodings produce the same decimal seeds", () => {
  const codes = {
    mtap: "336622999",
    pair: "32622293",
    fixed: "05140225",
    separated: "5-14-2-25"
  };
  for (const [method, code] of Object.entries(codes)) {
    assert.equal(METHODS[method].encode("ENBY"), code);
    assert.equal(METHODS[method].decode(code), "ENBY");
  }
  assert.equal(METHODS.base36.decode(METHODS.base36.encode("ENBY")), "ENBY");
});

test("decode keeps unambiguous spaces and checks whole numbers", () => {
  assert.equal(METHODS.mtap.decode(METHODS.mtap.encode("HELLO WORLD")), "HELLO WORLD");
  assert.equal(METHODS.mtap.decode("202"), "AA");
  assert.equal(METHODS.pair.decode("23x"), "");
  assert.equal(METHODS.fixed.decode("seed23"), "");
  assert.equal(METHODS.separated.decode("5 14,2-25"), "ENBY");
  assert.equal(METHODS.base36.decode("-36"), "-10");
});

test("multi-tap distinguishes an actual space between letters that share a key", () => {
  assert.equal(METHODS.mtap.encode("AB"), "2022");
  assert.equal(METHODS.mtap.decode("2022"), "AB");
  assert.equal(METHODS.mtap.encode("A B"), "2122");
  assert.equal(METHODS.mtap.decode("2122"), "A B");
  assert.equal(METHODS.mtap.encode("A  B"), "20022");
  assert.equal(METHODS.mtap.decode("20022"), "A  B");
  for (const text of ["A B C", "G H I G", "R S  T", "D  E "]) {
    assert.equal(METHODS.mtap.decode(METHODS.mtap.encode(text)), text);
  }
  assert.equal(METHODS.mtap.decode("213"), "");
});

test("case-insensitive methods accept lowercase without hiding what the seed drops", () => {
  for (const [name, expected] of Object.entries({ mtap: "66", pair: "62", fixed: "14", separated: "14", base36: "23" })) {
    const method = METHODS[name];
    const seed = method.encode("n");
    const reading = method.decode(seed);
    assert.equal(seed, expected, name);
    assert.ok(accepts("valheim", seed), name);
    assert.ok(matchesReading(method, reading, "n"), name);
    assert.deepEqual(caseReadings(method, reading), ["N", "n"], name);
    assert.equal(matchesReading(method, reading, "n "), false, name);
    assert.equal(matchesReading(method, reading, "n!"), false, name);
  }
  assert.ok(matchesReading(METHODS.fixed, "NAT", "nAt"));
  assert.deepEqual(caseReadings(METHODS.fixed, "NAT"), ["NAT", "nat", "Nat"]);
  assert.equal(matchesReading(METHODS.fixed, "S", "ſ"), false);
  assert.equal(matchesReading(METHODS.reverse, "N", "n"), false);
});

test("Valheim measures length in the game's seed field units", () => {
  assert.ok(accepts("valheim", "aB & moss"));
  assert.ok(accepts("valheim", "🐾".repeat(5)));
  assert.equal(accepts("valheim", "🐾".repeat(6)), false);
  assert.equal(accepts("valheim", "a\nb"), false);
});

test("Going Medieval supports unsigned seed values", () => {
  assert.ok(accepts("going-medieval", "0"));
  assert.ok(accepts("going-medieval", "4179239274"));
  assert.ok(accepts("going-medieval", "4294967295"));
  assert.equal(accepts("going-medieval", "4294967296"), false);
  assert.equal(accepts("going-medieval", "-1"), false);
});

test("method choices follow the preset’s seed syntax", () => {
  for (const game of Object.keys(PRESETS)) {
    const methods = matchingMethods(game).map(([id]) => id);
    assert.equal(methods.includes("separated"), !["isaac", "sts", "spelunky2", "deadcells"].includes(game), game);
    assert.ok(methods.includes("fixed"), game);
    assert.ok(methods.includes("upperLookalikes"), game);
    assert.equal(methods.includes("flipCase"),
      ["none", "valheim", "terraria", "isaac", "sts", "spelunky2"].includes(game), game);
  }
});

test("numeric games can read fixed A1Z26 after the game drops a leading zero", () => {
  for (const game of ["going-medieval", "lego", "midjourney", "minecraft", "factorio"]) {
    for (const text of ["a", "ab", "cat", "NAT"]) {
      const seed = METHODS.fixed.encode(text);
      const decimal = canonicalSeed(game, seed);
      assert.ok(accepts(game, seed), game);
      assert.equal(methodInput(game, "fixed", decimal), seed, game);
      assert.ok(matchesReading(METHODS.fixed, METHODS.fixed.decode(methodInput(game, "fixed", decimal)), text), game);
    }
    assert.equal(methodInput(game, "separated", "1"), "1");
  }
  assert.equal(methodInput("valheim", "fixed", "1"), "1");
  assert.equal(canonicalSeed("deadcells", "010101"), "010101");
});

test("look-alikes, casing and reverse put every character back in decoding", () => {
  const keyword = "E3  A4 e3 a4! 🐾";
  assert.equal(METHODS.upperLookalikes.encode("E3"), "3E");
  assert.equal(METHODS.lowerLookalikes.encode("e3"), "3e");
  assert.equal(METHODS.flipCase.encode("Moss Home"), "mOSS hOME");
  assert.equal(METHODS.upperLookalikes.encode("SEAT"), "5347");
  assert.ok(accepts("going-medieval", "5347"));
  for (const name of ["upperLookalikes", "lowerLookalikes", "flipCase", "reverse", "reverseLookalikes"]) {
    assert.equal(METHODS[name].decode(METHODS[name].encode(keyword)), keyword, name);
  }
  assert.equal(METHODS.upperLookalikes.decode("34"), "EA");
  assert.equal(METHODS.lowerLookalikes.decode("34"), "ea");
  assert.equal(METHODS.fixed.decode("0501"), "EA");
});
test("Force fit produces self-contained seeds within each game’s format", () => {
  for (const game of Object.keys(PRESETS).filter(ForceFit.hasSpace)) {
    const variants = ForceFit.encodeVariants(game, "ab");
    assert.ok(variants.length >= 2, game);
    assert.equal(new Set(variants.map(({ seed }) => seed)).size, variants.length, game);
    for (const { seed, label } of variants) {
      assert.ok(accepts(game, seed), game);
      const reading = ForceFit.readPacket(game, seed);
      assert.equal(reading.keyword, "ab", game);
      assert.equal(reading.label, label, game);
      if (game === "isaac") assert.ok(ForceFit.validIsaacSeed(seed));
    }
    assert.deepEqual(ForceFit.encodeVariants(game, "A phrase beyond the capacity of these seed fields 🐾".repeat(3)), []);
  }
  assert.equal(ForceFit.validIsaacSeed("12345678"), false);
});

test("the reported Valheim keyword decodes straight from each new seed", () => {
  for (const input of ["loving kindness", "Loving Kindness", "loving home", "É!", "ab ", "\ufeffa"]) {
    const variants = ForceFit.encodeVariants("valheim", input);
    assert.ok(variants.length >= 2, input);
    assert.deepEqual(variants, ForceFit.encodeVariants("valheim", input));
    for (const { seed } of variants) {
      assert.equal(seed.length, 10);
      assert.equal(ForceFit.readPacket("valheim", seed).keyword, input);
    }
  }
  assert.deepEqual(ForceFit.readLegacy("valheim", "~KY0cTpmgx"), { readings: [], olderCode: true });
  assert.equal(ForceFit.readLegacy("valheim", "~ErI6374JZ").readings.find((entry) => entry.variant === 1).keyword,
    "loving home");
});

test("the screenshot seeds expose different stored recipe IDs and preserve the trailing space", () => {
  const backward = ForceFit.inspect("packet", "valheim", "!1gd3JFT00");
  const forward = ForceFit.inspect("packet", "valheim", "!FOpoZjkTu");
  assert.equal(backward.keyword, "november ");
  assert.equal(forward.keyword, backward.keyword);
  assert.equal(backward.text.ordered, " rebmevon");
  assert.equal(forward.text.ordered, "november ");
  assert.deepEqual([backward.number, forward.number], [3, 2]);
  assert.deepEqual([backward.check, forward.check], [67n, 116n]);
  for (const trace of [backward, forward]) {
    assert.equal(trace.raw % trace.recipeCount, BigInt(trace.number));
    assert.equal(trace.raw / trace.recipeCount + 1n, trace.position);
    assert.equal(trace.check, trace.expected);
    assert.equal(trace.packet, trace.raw * trace.checks + trace.check);
    assert.equal(trace.packet, trace.slot.index);
  }
});

test("inspection exposes the offset of an entered key and the bytes of a generated key", () => {
  const keyed = ForceFit.inspect("packet", "valheim", "+sZRrICqlu", "love");
  assert.equal(keyed.keyword, "cozy home");
  assert.equal(keyed.keyHash.text, '["valheim","love"]');
  assert.equal(keyed.shift, keyed.keyHash.hash % keyed.capacity);
  assert.equal((keyed.packet + keyed.shift) % keyed.capacity, keyed.encoded);
  const { key, seed } = ForceFit.encodeRecovery("lego", "00 (202) 555-0199")[3];
  const split = ForceFit.inspect("recovery", "lego", seed, key);
  assert.equal(split.keyword, "00 (202) 555-0199");
  assert.equal(split.bytes[0], Number(split.slot.index % 256n));
  assert.equal(split.expected, split.slot.index);
  assert.equal(split.key, key);
});

test("a custom or generated key unlocks the exact keyword for the right seed", () => {
  for (const game of ["valheim", "going-medieval"]) {
    for (const key of ["love", "af0edc324a1b23f0"]) {
      const variants = ForceFit.encodeVariants(game, "cozy home", key);
      assert.deepEqual(variants, ForceFit.encodeVariants(game, "cozy home", key));
      assert.ok(variants.length >= 2);
      for (const { seed } of variants) {
        assert.ok(accepts(game, seed), game);
        assert.equal(ForceFit.readPacket(game, seed, key).keyword, "cozy home");
        assert.equal(ForceFit.readPacket(game, seed)?.keyword, undefined);
        assert.equal(ForceFit.readPacket(game, seed, "wrong")?.keyword, undefined);
      }
    }
  }
  assert.equal(ForceFit.readPacket("going-medieval", "unreadable"), null);
});

test("generated keys and seeds together preserve arbitrary keywords", () => {
  const inputs = [
    "00 (202) 555-0199",
    "  Amélie O’Neil  \n🌿 家 \t +#/",
    "a long keyword ".repeat(100) + "\ud800"
  ];
  for (const game of Object.keys(PRESETS).filter(ForceFit.hasSpace)) {
    for (const input of inputs) {
      const variants = ForceFit.encodeRecovery(game, input);
      assert.deepEqual(variants, ForceFit.encodeRecovery(game, input));
      assert.ok(variants.length > 1, game);
      assert.equal(new Set(variants.map(({ seed }) => seed)).size, variants.length, game);
      for (const { seed, key } of variants) {
        assert.ok(accepts(game, seed), game);
        if (game === "isaac") assert.ok(ForceFit.validIsaacSeed(seed));
        if (game === "spelunky2") assert.match(seed, /^[0-9A-F]{8}$/);
        assert.equal(ForceFit.recoveryGame(key), game);
        assert.equal(ForceFit.readRecovery(seed, key), input, game);
        assert.equal(ForceFit.readRecovery(seed, ""), null);
      }
      assert.equal(ForceFit.readRecovery(variants[0].seed, variants[1].key), null);
    }
  }
  assert.deepEqual(ForceFit.encodeRecovery("valheim", ""), []);
  assert.equal(ForceFit.readRecovery("1", "r1.valheim.0.invalid"), null);
});

test("rotating a keyword reverses exactly, including spaces and emoji", () => {
  const keyword = "🐾 Moss home ";
  const rotated = METHODS.rotate.encode(keyword);
  assert.equal(rotated, " Moss home 🐾");
  assert.equal(METHODS.rotate.decode(rotated), keyword);
});

test("both roll methods return seeds accepted by their game formats", () => {
  const random = { getRandomValues: (values) => values.fill(4294967295) };
  assert.match(PRESETS.valheim.roll(random), /^[A-Za-z0-9]{10}$/);
  for (const game of ["valheim", "going-medieval"]) {
    assert.ok(accepts(game, PRESETS[game].roll(random)));
  }
});

test("existing preset limits remain available", () => {
  assert.ok(accepts("lego", "2147483647"));
  assert.equal(accepts("lego", "2147483648"), false);
  assert.ok(accepts("midjourney", "4294967295"));
  assert.equal(accepts("factorio", "4294967296"), false);
  assert.ok(accepts("minecraft", "-9223372036854775808"));
  assert.equal(accepts("minecraft", "9223372036854775808"), false);
  assert.ok(accepts("deadcells", "123456"));
  assert.ok(accepts("terraria", "123456"));
  assert.equal(accepts("isaac", "12345678"), false);
  assert.ok(accepts("isaac", ForceFit.encodeRecovery("isaac", "look")[0].seed));
  assert.ok(accepts("spelunky2", "ABCDEF08"));
  assert.equal(accepts("spelunky2", "ABCDEFGH"), false);
});
