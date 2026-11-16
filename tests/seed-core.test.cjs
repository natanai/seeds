const assert = require("node:assert/strict");
const { test } = require("node:test");
const { METHODS, PRESETS, matchingMethods } = require("../seed-core.js");
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
    assert.equal(methods.includes("separated"), ["none", "valheim", "terraria"].includes(game), game);
    assert.ok(methods.includes("fixed"), game);
    assert.ok(methods.includes("upperLookalikes"), game);
    assert.equal(methods.includes("flipCase"),
      ["none", "valheim", "terraria", "isaac", "sts", "spelunky2"].includes(game), game);
  }
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
  assert.ok(accepts("isaac", "12345678"));
});
