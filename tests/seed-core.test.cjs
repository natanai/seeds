const assert = require("node:assert/strict");
const { test } = require("node:test");
const { METHODS, PRESETS, matchingMethods, makeSeed, seedKey, seedLink, readSeedLink } =
  require("../seed-core.js");
const ForceFit = require("../force-fit.js");

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

test("Valheim preserves the original short seed and uses the game's length units", () => {
  const preset = PRESETS.valheim;
  assert.deepEqual(preset.keyword("aB & moss"), { seed: "aB & moss" });
  assert.ok(makeSeed("valheim", "🐾".repeat(5)));
  assert.equal(makeSeed("valheim", "🐾".repeat(6)), null);
  assert.equal(makeSeed("valheim", "a\nb"), null);
  const long = preset.keyword("Moss forest and a cabin");
  assert.match(long.seed, /^Mos[A-Z0-9]{7}$/);
  assert.deepEqual(long, preset.keyword("Moss forest and a cabin"));
  assert.ok(makeSeed("valheim", long.seed));
  assert.deepEqual(preset.keyword("loving home"),
    { seed: "lov1RQR8G9", prefix: "lov", suffix: "1RQR8G9" });
});

test("Going Medieval supports unsigned seed values and repeatable keywords", () => {
  assert.equal(PRESETS["going-medieval"].keyword("hello").seed, "1335831723");
  assert.ok(makeSeed("going-medieval", "0"));
  assert.ok(makeSeed("going-medieval", "4179239274"));
  assert.ok(makeSeed("going-medieval", "4294967295"));
  assert.equal(makeSeed("going-medieval", "4294967296"), null);
  assert.equal(makeSeed("going-medieval", "-1"), null);
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
  assert.ok(makeSeed("going-medieval", "5347"));
  for (const name of ["upperLookalikes", "lowerLookalikes", "flipCase", "reverse", "reverseLookalikes"]) {
    assert.equal(METHODS[name].decode(METHODS[name].encode(keyword)), keyword, name);
  }
  assert.equal(METHODS.upperLookalikes.decode("34"), "EA");
  assert.equal(METHODS.lowerLookalikes.decode("34"), "ea");
  assert.equal(METHODS.fixed.decode("0501"), "EA");
});
test("Force fit uses each selected game's format and exactly reverses packed keywords", () => {
  for (const game of Object.keys(PRESETS).filter((game) => game !== "none")) {
    const packed = ForceFit.encode(game, "ab");
    assert.equal(packed.kind, "compact", game);
    assert.ok(makeSeed(game, packed.seed), game);
    assert.equal(ForceFit.decode(game, packed.seed).keyword, "ab", game);

    const keyword = "From the long road home, Áine & I found another world. 🐾";
    const hashed = ForceFit.encode(game, keyword);
    assert.equal(hashed.kind, "hash", game);
    assert.deepEqual(hashed, ForceFit.encode(game, keyword), game);
    assert.ok(makeSeed(game, hashed.seed), game);
    assert.deepEqual(ForceFit.decode(game, hashed.seed), { kind: "hash" }, game);
  }
  const packed = ForceFit.encode("valheim", "loving home");
  assert.equal(packed.seed.length, 10);
  assert.equal(ForceFit.decode("valheim", packed.seed).keyword, "loving home");
  for (const keyword of ["É!", "A 🐾", "ab ", "\ufeffa"]) {
    const encoded = ForceFit.encode("valheim", keyword);
    assert.equal(ForceFit.decode("valheim", encoded.seed).keyword, keyword);
  }
});

test("links and saved records retain the exact keyword even when game seeds collide", () => {
  const home = "https://natanai.github.io/seeds/";
  const settings = { terrain: "Marsh", size: "Large" };
  const keyword = "  Au-delà & 🐾 +# / ".repeat(120) + "\ud800";
  const record = makeSeed("going-medieval", "4179239274", { ...settings, keyword });
  const other = makeSeed("going-medieval", record.seed, { ...settings, keyword: keyword.toLowerCase() });
  const link = seedLink(home, record);
  assert.notEqual(seedKey(other), seedKey(record));
  assert.notEqual(seedLink(home, other), link);
  assert.equal(new URL(link).searchParams.has("keyword"), false);
  assert.deepEqual(readSeedLink(link, home), record);
  assert.equal(readSeedLink(link, "https://example.com/seeds/"), null);
  assert.deepEqual(readSeedLink(home + "?game=valheim&seed=AB", home), { game: "valheim", seed: "AB" });
});

test("both roll methods return seeds accepted by their game formats", () => {
  const random = { getRandomValues: (values) => values.fill(4294967295) };
  assert.match(PRESETS.valheim.roll(random), /^[A-Za-z0-9]{10}$/);
  for (const game of ["valheim", "going-medieval"]) {
    assert.ok(makeSeed(game, PRESETS[game].roll(random)));
  }
});

test("save and share keep the original seed and distinguish map settings", () => {
  const lake = makeSeed("going-medieval", "4179239274", { terrain: "Hillside", size: "Large" });
  const base = "https://natanai.github.io/seeds/?old=1#anchor";
  const parameters = new URL(seedLink(base, lake)).searchParams;
  assert.deepEqual(Object.fromEntries(parameters), lake);
  assert.notEqual(seedKey(lake), seedKey({ ...lake, size: "Small" }));
  assert.deepEqual(makeSeed("going-medieval", "4", { terrain: "bog", size: "tiny" }),
    { game: "going-medieval", seed: "4" });
  const seed = "aB +&🐾";
  const shared = new URL(seedLink(base, makeSeed("valheim", seed)));
  assert.equal(shared.pathname, "/seeds/");
  assert.equal(shared.searchParams.get("seed"), seed);
});

test("existing preset limits remain available", () => {
  assert.ok(makeSeed("lego", "2147483647"));
  assert.equal(makeSeed("lego", "2147483648"), null);
  assert.ok(makeSeed("midjourney", "4294967295"));
  assert.equal(makeSeed("factorio", "4294967296"), null);
  assert.ok(makeSeed("minecraft", "-9223372036854775808"));
  assert.equal(makeSeed("minecraft", "9223372036854775808"), null);
  assert.ok(makeSeed("deadcells", "123456"));
  assert.ok(makeSeed("terraria", "123456"));
  assert.ok(makeSeed("isaac", "12345678"));
});
