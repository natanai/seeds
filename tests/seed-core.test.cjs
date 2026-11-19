const assert = require("node:assert/strict");
const { test } = require("node:test");
const { METHODS, PRESETS, matchingMethods, matchesReading, caseReadings, canonicalSeed,
  inspectEncodings, inspectDecodings, FAMILIES } = require("../seed-core.js");
const PackedText = require("../packed-text.js");
const pack = (game, keyword) => PackedText.encode(game, keyword).filter(({ seed }) => seed);
const accepts = (game, seed) => PRESETS[game].validate(seed) === "";

const all = (readings) => Array.from({ length: Number(readings.count) }, (_, index) => readings.at(BigInt(index)));
const read = (game, seed) => all(inspectDecodings(game, seed));

test("encoders concatenate the digits for the keyword itself", () => {
  assert.equal(METHODS.alphabet.encode("ENBY"), "514225");
  assert.equal(METHODS.alphabet.encode("ABC"), "123");
  assert.equal(METHODS.mtap.encode("AB"), "222");
  assert.equal(METHODS.mtap.encode("A B"), "2022");
  assert.equal(METHODS.mtap.encode("  A  B "), "00200220");
  assert.equal(METHODS.pair.encode("ENBY"), "32622293");
  assert.equal(METHODS.pair.decode("32622293"), "ENBY");
  assert.equal(METHODS.pair.decode("23x"), "");
  assert.equal(METHODS.base36.decode(METHODS.base36.encode("ENBY")), "ENBY");
});

test("adjacent digits can carry several readings with the same encoding method", () => {
  assert.deepEqual(all(METHODS.alphabet.readings("123")), ["LC", "AW", "ABC"]);
  assert.deepEqual(all(METHODS.mtap.readings("222")), ["C", "BA", "AB", "AAA"]);
  assert.deepEqual(all(METHODS.mtap.readings("2022")), ["A B", "A AA"]);
  assert.ok(all(METHODS.mtap.readings(METHODS.mtap.encode("HELLO WORLD"))).includes("HELLO WORLD"));
  assert.equal(METHODS.mtap.readings("2122").count, 0n);
  assert.equal(METHODS.alphabet.readings("1-2"), null);
  assert.equal(METHODS.alphabet.readings("01").count, 0n);

  const rows = read("valheim", "222");
  for (const value of ["c", "ba", "ab", "aaa"]) {
    assert.ok(rows.some((entry) => entry.method === "mtap" && entry.value === value));
  }
  const many = METHODS.mtap.readings("7".repeat(64));
  assert.ok(many.count > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(many.at(many.count - 1n), "P".repeat(64));
  assert.equal(many.at(many.count), undefined);
});

test("case-insensitive methods accept lowercase without hiding what the seed drops", () => {
  for (const [name, expected] of Object.entries({ mtap: "66", pair: "62", alphabet: "14", base36: "23" })) {
    const method = METHODS[name];
    const seed = method.encode("n");
    const reading = method.readings ? method.readings(seed).at(0n) : method.decode(seed);
    assert.equal(seed, expected, name);
    assert.ok(accepts("valheim", seed), name);
    assert.ok(matchesReading(method, reading, "n"), name);
    assert.deepEqual(caseReadings(method, reading), ["N", "n"], name);
    assert.equal(matchesReading(method, reading, "n "), false, name);
    assert.equal(matchesReading(method, reading, "n!"), false, name);
  }
  assert.ok(matchesReading(METHODS.alphabet, "NAT", "nAt"));
  assert.deepEqual(caseReadings(METHODS.alphabet, "NAT"), ["NAT", "nat", "Nat"]);
  assert.equal(matchesReading(METHODS.alphabet, "S", "ſ"), false);
  assert.equal(matchesReading(METHODS.reverse, "N", "n"), false);
});

test("Valheim measures length in the game's seed field units", () => {
  assert.ok(accepts("valheim", "aB & moss"));
  assert.ok(accepts("valheim", "🐾".repeat(5)));
  assert.equal(accepts("valheim", "🐾".repeat(6)), false);
  assert.equal(accepts("valheim", "a\nb"), false);
});

test("seed format failures name the mismatched size, symbol, range, or check", () => {
  const nothing = METHODS.alphabet.encode("nothing");
  assert.equal(nothing, "14152089147");
  const isaac = pack("isaac", "ab")[0].seed;
  const badIsaac = isaac.slice(0, -1) + (isaac.endsWith("B") ? "C" : "B");
  for (const [game, seed, reason] of [
    ["valheim", nothing, /11 digits.*10 characters/],
    ["valheim", "a\nb", /contains a line break/],
    ["valheim", "🐾".repeat(6), /6 characters take 12 spots.*allows 10.*takes two/],
    ["valheim", "\ud800", /unpaired UTF-16 surrogate/],
    ["going-medieval", "4294967296", /4294967296 exceeds.*4294967295/],
    ["lego", "1-2", /contains "-".*0–9/],
    ["lego", "00000000001", /11 digits.*allows 10/],
    ["lego", "0", /0 is below.*of 1/],
    ["midjourney", "+1", /contains "\+"/],
    ["minecraft", "-", /minus sign needs at least one digit/],
    ["minecraft", "-9223372036854775809", /below.*-9223372036854775808/],
    ["terraria", "  ", /blank after trimming whitespace/],
    ["isaac", "12345678", /contains "5".*alphabet/],
    ["isaac", badIsaac, /checksum is \d+.*requires \d+/],
    ["sts", "1234 567", /7 characters after removing whitespace.*8–16/],
    ["spelunky2", "123G4567", /contains "G".*hexadecimal/],
    ["deadcells", "12345", /5 digits.*requires 6/],
    ["factorio", "4294967296", /4294967296 exceeds.*4294967295/]
  ]) assert.match(PRESETS[game].validate(seed), reason, game);
});

test("failed translations disclose the text they drop or change", () => {
  for (const [game, id, keyword, reason] of [
    ["valheim", "alphabet", "123", /needs a letter A–Z.*skipped "123"/],
    ["valheim", "alphabet", "N!", /skips "!".*Decode reads "N"/],
    ["valheim", "mtap", "00", /needs a letter A–Z or a space.*skipped "00"/],
    ["going-medieval", "mtap", "  AB", /stores "00222" as "222".*zeros represent spaces/],
    ["valheim", "base36", "00N", /drops 2 leading zeros.*Decode reads "N"/],
    ["lego", "literal", "001", /stores "001" as "1"/]
  ]) {
    const failed = inspectEncodings(game, keyword).failures.find((entry) => entry.id === id);
    assert.match(failed.reason, reason, game + "/" + id);
  }
});

test("Going Medieval supports unsigned seed values", () => {
  assert.ok(accepts("going-medieval", "0"));
  assert.ok(accepts("going-medieval", "4179239274"));
  assert.ok(accepts("going-medieval", "4294967295"));
  assert.equal(accepts("going-medieval", "4294967296"), false);
  assert.equal(accepts("going-medieval", "-1"), false);
});

test("Bannerlord accepts the full unsigned 32-bit seed field and reports invalid values", () => {
  for (const value of ["0", "2147483648", "4294967295"]) assert.ok(accepts("bannerlord", value), value);
  for (const value of ["", "-1", "+1", "1 2", "1.5", "Nat", "🌿", "4294967296"]) {
    assert.equal(accepts("bannerlord", value), false, value);
  }
  assert.match(PRESETS.bannerlord.validate("4294967296"), /4294967296 exceeds.*4294967295/);
  assert.equal(canonicalSeed("bannerlord", "00056"), "56");
  assert.match(inspectEncodings("bannerlord", "00056").failures.find(({ id }) => id === "literal").reason,
    /stores "00056" as "56"/);
  const roll = (value) => PRESETS.bannerlord.roll({ getRandomValues: (values) => values.fill(value) });
  assert.equal(roll(0), "0");
  assert.equal(roll(4294967295), "4294967295");
});

test("Bannerlord encodes meaningful keywords without markers and exposes possible originals", () => {
  for (const [keyword, id, value] of [
    ["Nat", "alphabet", "14120"],
    ["Nat", "mtap", "6628"],
    ["Nat", "pair", "622181"],
    ["Nat", "base36", "30197"],
    ["Nat", "packed-4", "5202548"],
    ["cozy home", "packed-0", "10446"],
    ["loving kindness", "packed-0", "1494"],
    ["2025550199", "literal", "2025550199"],
    ["SEAT", "upperLookalikes", "5347"],
    ["🌿", "packed-4", "4053831103"]
  ]) {
    const choice = inspectEncodings("bannerlord", keyword).choices.find((entry) => entry.id === id);
    assert.equal(choice?.value, value, keyword + "/" + id);
    assert.match(value, /^\d+$/);
    assert.ok(accepts("bannerlord", value));
    const method = METHODS[id];
    const readings = read("bannerlord", value).filter((reading) => choice.family === "packed"
      ? reading.kind === "packed" && reading.variant === choice.variant : reading.method === id);
    assert.ok(readings.some((reading) => matchesReading(method, reading.value, keyword)), keyword + "/" + id);
  }
  const tooLong = inspectEncodings("bannerlord", "Amélie and the long road home 555-0199");
  assert.deepEqual(tooLong.choices, []);
  assert.ok(tooLong.failures.every(({ reason }) => reason));
  assert.equal(matchingMethods("bannerlord").some(([id]) => id === "flipCase"), false);
});

test("method choices follow the preset’s seed syntax", () => {
  for (const game of Object.keys(PRESETS)) {
    const methods = matchingMethods(game).map(([id]) => id);
    assert.ok(methods.includes("alphabet"), game);
    assert.ok(methods.includes("upperLookalikes"), game);
    assert.equal(methods.includes("flipCase"),
      ["none", "valheim", "terraria", "isaac", "sts", "spelunky2"].includes(game), game);
  }
});

test("numeric games use the same unpadded alphabet positions", () => {
  for (const game of ["bannerlord", "going-medieval", "lego", "midjourney", "minecraft", "factorio"]) {
    const entry = inspectEncodings(game, "ab").choices.find(({ id }) => id === "alphabet");
    assert.equal(entry.value, "12");
    assert.ok(read(game, "12").some(({ method, value }) => method === "alphabet" && value === "ab"));
    assert.equal(canonicalSeed(game, "12"), "12");
  }
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
});
test("each packed text variant can be recovered from a valid game seed", () => {
  for (const game of Object.keys(PRESETS).filter(PackedText.hasSpace)) {
    const variants = pack(game, "ab");
    assert.ok(variants.length >= 2, game);
    for (const { seed, label } of variants) {
      assert.ok(accepts(game, seed), game);
      assert.ok(PackedText.readVariants(game, seed).some(({ keyword, label: name }) => keyword === "ab" && name === label), game);
    }
    assert.deepEqual(pack(game, "A phrase beyond the capacity of these seed fields 🐾".repeat(3)), []);
  }
});

test("the reported Valheim keyword decodes straight from each new seed", () => {
  for (const input of ["loving kindness", "Loving Kindness", "loving home", "É!", "ab ", "\ufeffa"]) {
    const variants = pack("valheim", input);
    assert.ok(variants.length >= 2, input);
    assert.deepEqual(variants, pack("valheim", input));
    for (const { seed, number } of variants) {
      assert.match(seed, /^[0-9A-Za-z]{1,10}$/);
      assert.equal(PackedText.readVariants("valheim", seed).find((entry) => entry.number === number)?.keyword, input);
    }
  }
});

test("punctuation in a keyword stays part of its literal reading", () => {
  for (const seed of ["!moss", "~moss", "5-14"]) {
    const literal = inspectEncodings("valheim", seed).choices.find(({ id }) => id === "literal");
    assert.equal(literal.value, seed);
    assert.equal(read("valheim", seed)[0].value, seed);
    assert.deepEqual(PackedText.readVariants("valheim", seed), []);
  }
});

test("packed seeds store only the game value and expose conflicting readings", () => {
  for (const [game, seed] of [["valheim", "u"], ["going-medieval", "56"]]) {
    const encoding = pack(game, "ab").find(({ label }) => label === "Base 27");
    assert.equal(encoding.seed, seed);
    const trace = PackedText.inspect(game, seed, encoding.number);
    assert.equal(trace.text.position, 57n);
    assert.equal(trace.slot.index, 56n);
    const readings = read(game, seed);
    for (const [label, value] of [["As typed", seed], ["Base 27", "ab"], ["Base 27 reversed", "ba"], ["UTF-8", "8"]]) {
      assert.ok(readings.some((entry) => entry.label === label && entry.value === value), game + "/" + label);
    }
  }
  for (const [game, seed] of [["sts", "00000056"], ["deadcells", "000056"], ["spelunky2", "00000038"]]) {
    assert.equal(pack(game, "ab").find(({ label }) => label === "Base 27").seed, seed);
  }
});

test("packing reports the first rejected symbol or the exact rank that overflows", () => {
  const attempts = PackedText.encode("valheim", "Amélie 01234567890");
  assert.equal(attempts.length, 6);
  assert.equal(attempts.some(({ seed }) => seed), false);
  assert.match(attempts.find(({ label }) => label === "Dictionary").reason, /"Amélie" has no entry/);
  assert.match(attempts.find(({ label }) => label === "Base 27").reason, /"A" has no digit/);
  assert.match(attempts.find(({ label }) => label === "UTF-8").reason, /\d+ bytes.*rank \d+.*holds up to \d+/);
  for (const { reason } of PackedText.encode("valheim", "\udc00\ud800").filter(({ mode }) => mode === "text")) {
    assert.match(reason, /incomplete Unicode character/);
  }
});

test("encoding families expose valid variants and explain failed attempts", () => {
  assert.deepEqual(Object.keys(FAMILIES), ["literal", "keypad", "alphabet", "base36", "transforms", "packed"]);
  const valheim = inspectEncodings("valheim", "nothing");
  const alphabet = valheim.failures.find(({ id }) => id === "alphabet");
  assert.equal(alphabet.family, "alphabet");
  assert.equal(alphabet.attempted, "14152089147");
  assert.match(alphabet.reason, /11 digits.*10 characters/);
  assert.ok(valheim.choices.some(({ family }) => family === "packed"));
  assert.ok(inspectEncodings("none", "a").disabled.has("packed"));
  assert.equal(inspectEncodings("lego", "ab").disabled.size, 0);

  const long = "Amélie (202) 555-0199 with the house keys";
  const unavailable = inspectEncodings("valheim", long);
  assert.deepEqual(unavailable.choices, []);
  assert.ok(unavailable.failures.every(({ reason }) => reason));

  for (const game of Object.keys(PRESETS)) {
    for (const keyword of ["n", "nAt", "A B", "001", "amélie", "loving kindness", long]) {
      for (const { id, family, value, variant } of inspectEncodings(game, keyword).choices) {
        assert.ok(accepts(game, value), game + "/" + id);
        const method = METHODS[id];
        const stored = canonicalSeed(game, value);
        if (method?.readings) {
          const symbols = [...keyword];
          const parts = symbols.map((symbol) => method.encode(symbol));
          assert.equal(parts.join(""), stored, game + "/" + id);
          assert.ok(parts.every((part, index) => all(method.readings(part))
            .some((reading) => matchesReading(method, reading, symbols[index]))), game + "/" + id);
          continue;
        }
        const candidates = read(game, stored).filter((entry) => family === "packed"
          ? entry.kind === "packed" && entry.variant === variant : entry.method === id);
        assert.ok(candidates.some((entry) => matchesReading(method, entry.value, keyword)), game + "/" + id);
      }
    }
  }
});

test("rotating a keyword reverses exactly, including spaces and emoji", () => {
  const keyword = "🐾 Moss home ";
  const rotated = METHODS.rotate.encode(keyword);
  assert.equal(rotated, " Moss home 🐾");
  assert.equal(METHODS.rotate.decode(rotated), keyword);
});

test("roll methods return seeds accepted by their game formats", () => {
  const random = { getRandomValues: (values) => values.fill(4294967295) };
  assert.match(PRESETS.valheim.roll(random), /^[A-Za-z0-9]{10}$/);
  for (const game of ["valheim", "bannerlord", "going-medieval"]) {
    assert.ok(accepts(game, PRESETS[game].roll(random)));
  }
});

test("game presets enforce their seed limits", () => {
  assert.ok(accepts("lego", "2147483647"));
  assert.equal(accepts("lego", "2147483648"), false);
  assert.ok(accepts("midjourney", "4294967295"));
  assert.equal(accepts("factorio", "4294967296"), false);
  assert.ok(accepts("minecraft", "-9223372036854775808"));
  assert.equal(accepts("minecraft", "9223372036854775808"), false);
  assert.ok(accepts("deadcells", "123456"));
  assert.ok(accepts("terraria", "123456"));
  assert.equal(accepts("isaac", "12345678"), false);
  assert.ok(accepts("isaac", pack("isaac", "ab")[0].seed));
  assert.ok(accepts("spelunky2", "ABCDEF08"));
  assert.equal(accepts("spelunky2", "ABCDEFGH"), false);
});
