const assert = require("node:assert/strict");
const { test } = require("node:test");
const { METHODS, PRESETS, matchingMethods, matchesReading, caseReadings, canonicalSeed, methodInput,
  translationError, inspectEncodings, inspectDecodings, FAMILIES } = require("../seed-core.js");
const PackedText = require("../packed-text.js");
const pack = (game, keyword) => PackedText.encode(game, keyword).filter(({ seed }) => seed);
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

test("seed format failures name the mismatched size, symbol, range, or check", () => {
  const nothing = METHODS.fixed.encode("nothing");
  assert.equal(nothing, "14152008091407");
  const isaac = pack("isaac", "ab")[0].seed;
  const badIsaac = isaac.slice(0, -1) + (isaac.endsWith("B") ? "C" : "B");
  for (const [game, seed, reason] of [
    ["valheim", nothing, /14 digits.*10 characters/],
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
  for (const [id, keyword, reason] of [
    ["fixed", "123", /needs a letter A–Z.*skipped "123"/],
    ["fixed", "N!", /skips "!".*Decode reads "N"/],
    ["mtap", "00", /turns "00" into zeros and drops them/],
    ["mtap", "  AB", /drops the zeros for leading spaces.*"AB"/],
    ["base36", "00N", /drops 2 leading zeros.*Decode reads "N"/]
  ]) {
    const method = METHODS[id];
    const seed = method.encode(keyword);
    assert.match(translationError("valheim", id, keyword, seed, seed, method.decode(seed)), reason, id);
  }
  assert.match(translationError("lego", "literal", "001", "001", "1", "1"), /stores "001" as "1"/);
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
  assert.deepEqual(PackedText.readLegacy("valheim", "~KY0cTpmgx"), { readings: [], olderCode: true });
  assert.equal(PackedText.readLegacy("valheim", "~ErI6374JZ").readings.find((entry) => entry.variant === 1).keyword,
    "loving home");
});

test("older seeds remain readable alongside current interpretations", () => {
  const backward = PackedText.inspect("packet", "valheim", "!1gd3JFT00");
  const forward = PackedText.inspect("packet", "valheim", "!FOpoZjkTu");
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
  const marked = inspectDecodings("valheim", "!1gd3JFT00").readings;
  assert.ok(marked.some(({ id, value }) => id === "packet" && value === "november "));
  assert.ok(marked.some(({ id, value }) => id === "literal" && value === "!1gd3JFT00"));
  assert.ok(marked.some(({ method, value }) => method === "reverse" && value === "00TFJ3dg1!"));
  assert.ok(inspectDecodings("going-medieval", "62964").readings.some(({ id, value }) => id === "packet" && value === "ab"));
});

test("packed seeds store only the game value and expose conflicting readings", () => {
  for (const [game, seed] of [["valheim", "u"], ["going-medieval", "56"]]) {
    const encoding = pack(game, "ab").find(({ label }) => label === "Base 27");
    assert.equal(encoding.seed, seed);
    const trace = PackedText.inspect("packed", game, seed, encoding.number);
    assert.equal(trace.text.position, 57n);
    assert.equal(trace.slot.index, 56n);
    const { readings } = inspectDecodings(game, seed);
    for (const [label, value] of [["As typed", seed], ["Base 27", "ab"], ["Base 27 reversed", "ba"], ["UTF-8", "8"]]) {
      assert.ok(readings.some((entry) => entry.label === label && entry.value === value), game + "/" + label);
    }
  }
  const hex = inspectDecodings("spelunky2", "00000014").readings;
  assert.ok(hex.some(({ method, value }) => method === "separated" && value === "N"));
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
  const fixed = valheim.failures.find(({ id }) => id === "fixed");
  assert.equal(fixed.family, "alphabet");
  assert.equal(fixed.attempted, "14152008091407");
  assert.match(fixed.reason, /14 digits.*10 characters/);
  assert.ok(valheim.choices.some(({ family }) => family === "packed"));
  assert.ok(inspectEncodings("none", "a").disabled.has("packed"));
  assert.equal(inspectEncodings("lego", "ab").disabled.size, 0);
  assert.equal(inspectEncodings("lego", "ab").failures.find(({ id }) => id === "separated").attempted, "1-2");

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
        const reading = family === "packed" ? PackedText.readVariants(game, value).find(({ number }) => number === variant)?.keyword
          : method ? method.decode(methodInput(game, id, stored)) : stored;
        assert.ok(matchesReading(method, reading, keyword), game + "/" + id);
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
  assert.ok(accepts("isaac", pack("isaac", "ab")[0].seed));
  assert.ok(accepts("spelunky2", "ABCDEF08"));
  assert.equal(accepts("spelunky2", "ABCDEFGH"), false);
});
