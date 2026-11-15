const assert = require("node:assert/strict");
const { test } = require("node:test");
const { METHODS, PRESETS, makeSeed, seedKey, seedLink } = require("../seed-core.js");

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
  assert.equal(preset.encode("aB & moss"), "aB & moss");
  assert.ok(makeSeed("valheim", "🐾".repeat(5)));
  assert.equal(makeSeed("valheim", "🐾".repeat(6)), null);
  assert.equal(makeSeed("valheim", "a\nb"), null);
  const long = preset.encode("Moss forest and a cabin");
  assert.match(long, /^Mos[A-Z0-9]{7}$/);
  assert.equal(long, preset.encode("Moss forest and a cabin"));
  assert.ok(makeSeed("valheim", long));
});

test("Going Medieval supports unsigned seed values and repeatable phrases", () => {
  assert.equal(PRESETS["going-medieval"].encode("hello"), "1335831723");
  assert.ok(makeSeed("going-medieval", "0"));
  assert.ok(makeSeed("going-medieval", "4179239274"));
  assert.ok(makeSeed("going-medieval", "4294967295"));
  assert.equal(makeSeed("going-medieval", "4294967296"), null);
  assert.equal(makeSeed("going-medieval", "-1"), null);
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
