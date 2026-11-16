"use strict";

(() => {
  const {
    KEYMAP, MAP_TYPES, MAP_SIZES, PRESETS, VALHEIM_LIMIT, matchingMethods,
    makeSeed, seedKey, seedLink, readSeedLink
  } = SeedTools;
  const byId = (id) => document.getElementById(id);
  const gameSelect = byId("game");
  const methodSelect = byId("method");
  const terrainSelect = byId("terrain");
  const sizeSelect = byId("map-size");
  const keywordInput = byId("keyword");
  const seedInput = byId("seed-input");
  const resultValue = byId("result-value");
  const resultStatus = byId("result-status");
  const savedKey = "meaningful-seeds.saved";
  const gameKey = "meaningful-seeds.game";
  const search = new URLSearchParams(location.search);
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const collectionButtons = [...document.querySelectorAll("[data-collection]")];
  const ENCODE_METHODS = { keyword: "Keyword seed", number: "Number code", fit: "Force fit" };

  function readStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function readSaved() {
    const records = readStorage(savedKey);
    return Array.isArray(records)
      ? records.map((entry) => entry && makeSeed(entry.game, entry.seed, entry)).filter(Boolean)
      : [];
  }

  function validGame(value) {
    return Object.hasOwn(PRESETS, value) ? value : "none";
  }

  let game = validGame(search.get("game") ?? readStorage(gameKey));
  let view = search.has("seed") ? "decode" : "encode";
  let recovery = readSeedLink(location.href, location.href);
  let encodeMethod = firstEncodeMethod(game);
  let encodeVariation;
  let methodVariations = [];
  let diceChoices = [];
  const rolledSeeds = new Set();
  const keys = { encode: "", decode: "" };
  let decodeMethod = "game";
  let saved = readSaved();
  let collection = saved.some((entry) => game === "none" || entry.game === game)
    ? "saved" : "examples";
  let libraryIndex = 0;
  let readingPage = 0;
  let readingLimit = 0;
  let currentResult = {};
  let phoneKeyword = "";
  let pendingKey = "";
  let tapTimer;

  for (const [id, preset] of Object.entries(PRESETS)) {
    gameSelect.add(new Option(preset.label, id));
  }
  terrainSelect.add(new Option("Terrain", ""));
  sizeSelect.add(new Option("Map size", ""));
  MAP_TYPES.forEach((name) => terrainSelect.add(new Option(name, name)));
  MAP_SIZES.forEach((name) => sizeSelect.add(new Option(name, name)));
  gameSelect.value = game;
  terrainSelect.value = MAP_TYPES.includes(search.get("terrain")) ? search.get("terrain") : "";
  sizeSelect.value = MAP_SIZES.includes(search.get("size")) ? search.get("size") : "";
  seedInput.value = search.get("seed") ?? "";

  function settings() {
    return { terrain: terrainSelect.value, size: sizeSelect.value };
  }

  function fitsPreset() {
    if (game === "valheim") return "Fits Valheim. Keep the original capitalization.";
    if (game === "going-medieval") return "Fits Going Medieval. Preview it in Location selection.";
    return game === "none" ? "" : "Fits " + PRESETS[game].label + ".";
  }

  function knownKeyword() {
    return recovery?.game === game && recovery.seed === seedInput.value ? recovery.keyword : undefined;
  }

  function firstEncodeMethod(format) {
    if (PRESETS[format].keyword) return "keyword";
    return ForceFit.hasSpace(format) ? "fit" : "number";
  }

  function validateEncoding(value, preset) {
    const error = preset.validate(value);
    if (error) return error;
    if (game === "isaac" && !ForceFit.validIsaacSeed(value)) return "This seed fails Isaac’s checksum.";
    if (game === "spelunky2" && !/^[0-9A-F]{8}$/i.test(value)) return "Use eight hexadecimal digits.";
    return "";
  }

  function packedReadingDiffers(seed, keyword) {
    const packet = ForceFit.readPacket(game, seed);
    if (packet) return packet.keyword !== keyword;
    return game === "valheim" && ForceFit.readLegacy(game, seed).olderCode;
  }

  function keywordCandidate(input, preset) {
    const { seed, prefix, suffix } = preset.keyword(input);
    const literal = game === "valheim" && !suffix;
    const exact = literal && !packedReadingDiffers(seed, input);
    const label = literal ? "As typed" : "Short code";
    const hint = exact ? "The seed is your keyword as typed." : "Save or share to keep the original keyword.";
    let rule = "The app uses all the text you typed to make a repeatable number for this game.";
    if (game === "valheim") {
      rule = literal
        ? "Valheim gives you up to " + VALHEIM_LIMIT + " characters. Some symbols, such as emoji, take two spots."
        : "The app keeps the first three letters or numbers it finds and adds a short code made from the full keyword.";
    }
    return {
      id: "game-keyword", method: "keyword", label, value: seed, error: "", exact,
      hint: input ? hint : "Enter a keyword to make a seed.",
      explanation: {
        rule,
        detail: exact ? "" : "The code can create a world. Save or Share keeps the full text for later.",
        example: suffix && prefix ? prefix + " + " + suffix : ""
      }
    };
  }

  function fitChoices(input, key) {
    const options = ForceFit.encodeVariants(game, input, key);
    if (!options.length) {
      return [{
        id: "fit", method: "fit", label: input ? "Try shorter wording" : "Keep the whole keyword",
        value: "", error: "", hint: input ? "This text takes more space than the seed has." : "",
        explanation: {
          rule: "Force fit puts the full keyword inside the seed when it fits. Words from the app’s list take up less room.",
          detail: key ? "Your key changes how the text is stored. The game still sets the seed length."
            : "Shorter wording can fit. Keyword seed can also make a short code you can save with the full text."
        }
      }];
    }
    return options.map(({ mode, backward, label, number, keyed, seed }) => {
      const unit = mode === "words" ? "words" : mode === "letters" ? "letters and spaces" : "characters";
      const sequence = mode === "words" ? input.split(" ") : [...input];
      const example = backward ? sequence.reverse().join(mode === "words" ? " " : "") : "";
      const rule = mode === "words"
        ? "The app looks up each word in its built-in list and puts the word numbers and capitalization into the seed."
        : mode === "letters" ? "The app uses a small number for each lowercase letter and space."
          : "The app puts every character, including spaces, into the seed.";
      const order = backward ? "It stores the " + unit + " from last to first. " : "It keeps their original order. ";
      const recovery = keyed ? "Your key changes the seed. Use the same key in Decode."
        : "Paste the seed by itself into Decode.";
      return {
        id: "fit-" + number, method: "fit", label, value: seed, error: "", exact: true, keyed,
        hint: keyed ? "Decode needs the same key." : "The seed alone can recover the keyword.",
        explanation: { rule, detail: order + recovery, example }
      };
    });
  }

  function decodeCandidates(input, preset) {
    const packet = ForceFit.readPacket(game, input, keys.decode);
    const decoded = packet?.status === "decoded";
    const older = packet ? null : ForceFit.readLegacy(game, input);
    const original = knownKeyword();
    const remembered = original === undefined ? [] : [{
      id: "original", label: "Original keyword", value: original, error: "",
      hint: "Recovered from the seed link or saved entry."
    }];
    const messages = {
      "key-needed": "Tap Key and enter the key used to make this seed.",
      "key-mismatch": "Check the seed and the key used to make it.",
      "copy-check": "Check that the whole seed was copied."
    };
    let hint = input ? fitsPreset() : "Paste a seed or share link.";
    if (packet) hint = messages[packet.status] ?? hint;
    else if (older?.olderCode) hint = "To recover this older seed’s keyword, open its saved entry or share link.";
    else if (input && keys.decode) hint = "The entered key did not recover a keyword for this seed.";
    const gameSeed = {
      id: "game", label: "Game seed", value: input, error: input ? preset.validate(input) : "", hint,
      hideReadings: Boolean((packet && !decoded) || older?.olderCode) && !remembered.length,
      keyed: packet?.keyed || packet?.status === "key-needed" || packet?.status === "key-mismatch"
    };

    const matchingPacket = [];
    if (decoded && (original === undefined || original === packet.keyword)) {
      const automatic = game === "valheim" || packet.keyed;
      const recovered = {
        id: "packet", label: packet.label, value: packet.keyword, error: "", packed: true, keyed: packet.keyed,
        automatic, hint: packet.keyed ? "Recovered from the seed and key."
          : automatic ? "Recovered from the seed alone." : "This seed can be read as this keyword."
      };
      if (automatic) return [gameSeed, recovered];
      matchingPacket.push(recovered);
    }
    if ((packet && !decoded) || older?.olderCode) return [gameSeed, ...remembered];

    const legacy = (older?.readings ?? []).map(({ variant, keyword }) => ({
      id: "older-" + variant, label: "Older Force fit " + (variant + 1), value: keyword,
      packed: true, error: "", hint: "A possible keyword from an earlier version."
    }));
    const readings = matchingMethods(game).flatMap(([id, method]) => {
      const value = method.decode(input);
      return value ? [{
        id, label: method.label, value, reversible: Boolean(method.steps), error: "",
        hint: "Open a share link or saved entry for the exact keyword."
      }] : [];
    });
    return [gameSeed, ...remembered, ...matchingPacket, ...legacy, ...readings];
  }

  function getCandidates() {
    const preset = PRESETS[game];
    if (view === "decode") return decodeCandidates(seedInput.value, preset);

    const input = keywordInput.value;
    const key = keys.encode;
    const packed = ForceFit.hasSpace(game) ? fitChoices(input, key) : [];
    if (key && packed.length) return packed;
    const methods = matchingMethods(game).map(([id, method]) => {
      const value = method.encode(input);
      const reversible = Boolean(method.steps);
      const error = !input ? "" : value ? validateEncoding(value, preset) : "This variation needs different letters or digits.";
      const exact = Boolean(value && !error && (reversible || method.decode(value) === input) &&
        !packedReadingDiffers(value, input));
      return {
        id, label: method.label, value, error, exact, method: reversible ? "keyword" : "number",
        hint: value && !exact ? "Save or share to keep the original keyword." : fitsPreset() || method.hint,
        explanation: { rule: method.steps ?? method.hint }
      };
    });
    const keyword = preset.keyword ? keywordCandidate(input, preset) : {
      id: "as-typed", method: "keyword", label: "As typed", value: input,
      error: input ? validateEncoding(input, preset) : "",
      exact: Boolean(input && !packedReadingDiffers(input, input)),
      hint: input ? fitsPreset() : "Enter a keyword to use as a seed.",
      explanation: { rule: "Use the keyword as typed when it fits the game’s seed field." }
    };
    return [keyword, ...packed, ...methods];
  }

  function choiceKey(value) {
    return (PRESETS[game].numeric || game === "minecraft") && /^-?\d+$/.test(value)
      ? BigInt(value).toString() : value;
  }

  function distinctChoices(candidates) {
    const unique = new Map();
    for (const candidate of candidates) {
      if (!candidate.value || candidate.error) continue;
      const key = choiceKey(candidate.value);
      const existing = unique.get(key);
      if (!existing || (candidate.exact && !existing.exact)) unique.set(key, candidate);
    }
    return [...unique.values()];
  }

  function selectEncoding(candidates) {
    const methods = new Set(candidates.map((candidate) => candidate.method));
    const choices = Object.entries(ENCODE_METHODS).filter(([id]) => methods.has(id));
    if (!methods.has(encodeMethod)) encodeMethod = choices[0][0];

    const optionsChanged = choices.length !== methodSelect.options.length ||
      choices.some(([id, label], index) => {
        const option = methodSelect.options[index];
        return option.value !== id || option.text !== label;
      });
    if (optionsChanged) {
      methodSelect.replaceChildren(...choices.map(([id, label]) => new Option(label, id)));
    }
    methodSelect.value = encodeMethod;

    const withinMethod = candidates.filter((candidate) => candidate.method === encodeMethod);
    methodVariations = distinctChoices(withinMethod);
    diceChoices = distinctChoices(candidates.filter((candidate) => candidate.exact));
    const previous = withinMethod.find((candidate) => candidate.id === encodeVariation && !candidate.error && candidate.value);
    const selected = previous ?? methodVariations[0] ?? withinMethod[0];
    encodeVariation = selected.id;
    byId("next-variation").disabled = methodVariations.length < 2;
    byId("choose-seed").disabled = !diceChoices.some((candidate) => choiceKey(candidate.value) !== choiceKey(selected.value));
    return selected;
  }

  function showVariation(candidate) {
    encodeMethod = candidate.method;
    encodeVariation = candidate.id;
    keywordInput.blur();
    refresh();
  }

  function nextVariation() {
    if (methodVariations.length < 2) return;
    const current = choiceKey(currentResult.value);
    const index = methodVariations.findIndex((candidate) => choiceKey(candidate.value) === current);
    showVariation(methodVariations[(index + 1) % methodVariations.length]);
  }

  function chooseSeed() {
    const current = choiceKey(currentResult.value);
    const alternatives = diceChoices.filter((candidate) => choiceKey(candidate.value) !== current);
    if (!alternatives.length) return;
    rolledSeeds.add(current);
    let pool = alternatives.filter((candidate) => !rolledSeeds.has(choiceKey(candidate.value)));
    if (!pool.length) {
      rolledSeeds.clear();
      pool = alternatives;
    }
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    rolledSeeds.add(choiceKey(chosen.value));
    showVariation(chosen);
  }

  function readingsPerPage() {
    const height = app.clientHeight;
    if (height <= 355) return app.clientWidth >= 530 ? 2 : 1;
    if (height <= 495) return 1;
    if (height <= 595) return 2;
    if (height <= 685) return 3;
    return 4;
  }

  function renderReadings(candidates) {
    const list = byId("reading-list");
    const priority = ({ id, reversible }) => {
      if (id === "original") return 0;
      if (id === "packet" || (id === "older-0" && game === "valheim")) return 1;
      return reversible ? 2 : 3;
    };
    const readings = candidates.filter(({ id, value, error }) => id !== "game" && value && !error)
      .sort((left, right) => priority(left) - priority(right));
    readingLimit = readingsPerPage();
    const pages = Math.max(1, Math.ceil(readings.length / readingLimit));
    readingPage = Math.min(readingPage, pages - 1);
    byId("reading-count").textContent = readings.length === 0 ? "No matching readings"
      : readings.length + (readings.length === 1 ? " reading" : " readings");
    byId("reading-page").value = (readingPage + 1) + " / " + pages;
    byId("reading-pager").hidden = pages === 1;
    byId("reading-previous").disabled = readingPage === 0;
    byId("reading-next").disabled = readingPage === pages - 1;

    const first = readingPage * readingLimit;
    const buttons = readings.slice(first, first + readingLimit).map(({ id, label, value }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reading";
      const name = document.createElement("span");
      name.textContent = label;
      const keyword = document.createElement("code");
      keyword.textContent = value;
      button.append(name, keyword);
      button.addEventListener("click", () => {
        decodeMethod = id;
        refresh();
        byId("all-readings").focus({ preventScroll: true });
      });
      return button;
    });
    list.replaceChildren(...buttons);
  }

  function catalogEntries(entries) {
    return game === "none" ? entries : entries.filter((entry) => entry.game === game);
  }

  function renderLibrary() {
    const items = catalogEntries(collection === "saved" ? saved : seedExamples);
    libraryIndex = Math.min(libraryIndex, Math.max(0, items.length - 1));
    const entry = items[libraryIndex];
    byId("library-pager").hidden = items.length < 2;
    byId("library-count").value = (libraryIndex + 1) + " / " + items.length;
    byId("previous").disabled = libraryIndex === 0;
    byId("next").disabled = libraryIndex >= items.length - 1;
    for (const button of collectionButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.collection === collection));
    }

    if (!entry) {
      const label = game === "none" ? "" : PRESETS[game].label + " ";
      const note = collection === "saved"
        ? "No " + label + "seeds saved."
        : "No examples for " + PRESETS[game].label + ".";
      renderResult({ showValue: false, actions: false, note });
      return;
    }

    const record = makeSeed(entry.game, entry.seed, entry);
    const example = collection === "examples" ? entry
      : seedExamples.find((item) => seedKey(item) === seedKey(entry));
    const details = [
      game === "none" ? PRESETS[entry.game].label : "",
      entry.terrain,
      entry.size ? entry.size + " map" : "",
      record?.keyword !== undefined ? "Keyword saved" : "",
      example?.description
    ].filter(Boolean);
    renderResult({
      value: entry.seed, label: example?.title ?? "Seed", note: details.join(" · "),
      record, source: example?.source, allowRecovery: record?.keyword !== undefined
    });
  }

  function renderResult({
    value = "", label = "Seed", note = "", error = "", record = null, source,
    showValue = true, seedActions = true, actions = true, explanation, allowRecovery = false,
    variation
  }) {
    currentResult = { value, record, showValue, explanation };
    byId("explain-method").hidden = !explanation;
    byId("recover-saved").hidden = !allowRecovery;
    byId("value-row").hidden = !showValue;
    byId("result-label").textContent = label;
    resultValue.value = value;
    resultStatus.textContent = error || note;
    resultStatus.dataset.invalid = String(Boolean(error));
    resultStatus.closest(".result-note").hidden = !error && !note && !source && !allowRecovery && !variation;
    const variationName = byId("variation-name");
    variationName.hidden = !variation;
    variationName.textContent = variation ?? "";
    byId("next-variation").hidden = !variation;

    const sourceLink = byId("source");
    sourceLink.hidden = !source;
    if (source) sourceLink.href = source;

    byId("copy").parentElement.hidden = !actions;
    const copy = byId("copy");
    copy.disabled = !value;
    copy.setAttribute("aria-label", label.endsWith("keyword") ? "Copy keyword" : "Copy");
    const saveButton = byId("save");
    saveButton.hidden = !seedActions;
    const isSaved = record && saved.some((entry) => seedKey(entry) === seedKey(record));
    saveButton.disabled = !record;
    saveButton.textContent = isSaved ? "Remove" : "Save";
    saveButton.setAttribute("aria-label", isSaved ? "Remove saved seed" : "Save seed");
    byId("share").hidden = !seedActions;
    byId("share").disabled = !record;

    const map = byId("map");
    map.hidden = record?.game !== "valheim";
    if (!map.hidden) {
      const url = new URL("https://m.valheim-map.world/");
      url.searchParams.set("seed", record.seed);
      map.href = url.href;
    }
  }

  function render() {
    byId("workspace").dataset.view = view;
    for (const tab of tabs) {
      const active = tab.dataset.tab === view;
      byId(tab.dataset.tab + "-panel").hidden = !active;
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    byId("result").hidden = view === "keypad";
    byId("method-row").hidden = view !== "encode";
    byId("reading-detail").hidden = true;
    byId("readings").hidden = true;
    byId("workspace").removeAttribute("data-decode-list");
    byId("map-settings").hidden = true;
    byId("roll").hidden = !PRESETS[game].roll;
    byId("encode-key").hidden = !ForceFit.hasSpace(game);
    for (const mode of ["encode", "decode"]) {
      const button = byId(mode + "-key");
      button.textContent = keys[mode] ? "Key set" : "Key";
      button.setAttribute("aria-label", keys[mode] ? "Change secret key" : "Secret key");
    }

    if (view === "keypad") {
      renderPhone();
      return;
    }
    if (view === "seeds") {
      renderLibrary();
      return;
    }

    const encoding = view === "encode";
    const candidates = getCandidates();
    const autoPacket = !encoding && decodeMethod === "game" && candidates.find((candidate) => candidate.automatic);
    const selected = encoding ? selectEncoding(candidates)
      : autoPacket || candidates.find((candidate) => candidate.id === decodeMethod) || candidates[0];
    const { id, value, error, hint, explanation, label: methodLabel, packed } = selected;
    if (!encoding) decodeMethod = id;

    const gameSeed = id === "game";
    if (gameSeed && seedInput.value && !selected.hideReadings) {
      byId("workspace").setAttribute("data-decode-list", "");
      byId("readings").hidden = false;
      renderReadings(candidates);
    }
    if (!encoding && !gameSeed && !selected.automatic) {
      byId("reading-detail").hidden = false;
      byId("reading-method").textContent = methodLabel;
    }
    const exact = !encoding && (id === "original" || packed);
    const seedActions = encoding || gameSeed || (exact && Boolean(value));
    const inputMode = !encoding && seedActions && PRESETS[game].numeric ? "numeric" : "text";
    if (seedInput.inputMode !== inputMode) seedInput.inputMode = inputMode;
    byId("map-settings").hidden = game !== "going-medieval" || !seedActions;

    const seed = encoding ? value : seedInput.value;
    const original = encoding ? keywordInput.value : knownKeyword() ?? (exact ? value : undefined);
    const keyword = selected.keyed ? undefined : original;
    const record = seedActions && !error ? makeSeed(game, seed, { ...settings(), keyword }) : null;
    let label = "Seed";
    if (!encoding && !gameSeed) {
      label = selected.automatic ? "Recovered keyword" : id === "original" ? "Original keyword"
        : exact ? "Possible keyword" : "Possible reading";
    }
    renderResult({
      value, error, note: hint, record, seedActions, label, explanation,
      variation: encoding ? methodLabel : undefined,
      showValue: !gameSeed && (!exact || Boolean(value))
    });
  }

  function notice(message = "") {
    byId("notice").textContent = message;
  }

  function refresh() {
    notice();
    render();
  }

  function navigate(nextView) {
    const focused = document.activeElement;
    if (view !== nextView && focused?.matches("input")) focused.blur();
    view = nextView;
    byId("workspace").scrollTop = 0;
    refresh();
  }

  function useGame(format) {
    game = format;
    gameSelect.value = game;
    encodeMethod = firstEncodeMethod(game);
    encodeVariation = undefined;
    rolledSeeds.clear();
    libraryIndex = 0;
  }

  function openSeed(record, showKeyword = false) {
    if (game !== record.game) useGame(record.game);
    recovery = record;
    seedInput.value = record.seed;
    terrainSelect.value = record.terrain ?? "";
    sizeSelect.value = record.size ?? "";
    readingPage = 0;
    decodeMethod = showKeyword && record.keyword !== undefined ? "original" : "game";
    navigate("decode");
  }

  function explainMethod() {
    const { explanation } = currentResult;
    if (!explanation) return;
    byId("method-title").textContent = "How this seed is made";
    byId("method-rule").textContent = explanation.rule;
    byId("method-detail").textContent = explanation.detail ?? "";
    byId("method-detail").hidden = !explanation.detail;
    byId("method-example").textContent = explanation.example ?? "";
    byId("method-example").hidden = !explanation.example;
    byId("method-dialog").showModal();
  }

  function editKey() {
    const input = byId("key-input");
    input.value = keys[view];
    byId("generate-key").hidden = view !== "encode";
    byId("copy-key").disabled = !input.value;
    byId("key-note").textContent = view === "encode"
      ? "Enter a key or generate one. Keep it to use with this seed in Decode."
      : "Enter the key you used to make this seed.";
    byId("key-dialog").showModal();
  }

  function applyKey(event) {
    event.preventDefault();
    keys[view] = byId("key-input").value;
    if (view === "encode") {
      if (keys.encode) encodeMethod = "fit";
      encodeVariation = undefined;
      rolledSeeds.clear();
    } else {
      decodeMethod = "game";
      readingPage = 0;
    }
    byId("key-dialog").close();
    refresh();
  }

  function toggleSave() {
    const { record } = currentResult;
    if (!record) return;
    const key = seedKey(record);
    const latest = readSaved();
    const exists = latest.some((entry) => seedKey(entry) === key);
    const records = exists ? latest.filter((entry) => seedKey(entry) !== key) : [record, ...latest];
    if (!writeStorage(savedKey, records)) {
      notice("Couldn’t save on this device.");
      return;
    }
    saved = records;
    if (!exists && view !== "seeds") {
      collection = "saved";
      libraryIndex = 0;
    }
    render();
    if (view === "seeds" && byId("save").disabled) {
      collectionButtons.find((button) => button.dataset.collection === collection)?.focus();
    }
    notice(exists ? "Removed from Saved." : "Saved on this device.");
  }

  async function copyText(text) {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Selecting a temporary field also works in some embedded browsers.
      }
    }

    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true;
    field.className = "clipboard";
    const focused = document.activeElement;
    document.body.append(field);
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
      focused?.focus({ preventScroll: true });
    }
  }

  async function copyResult() {
    const { value, showValue } = currentResult;
    if (!value) return;
    if (await copyText(value)) {
      notice("Copied.");
      return;
    }
    const field = showValue ? resultValue : seedInput;
    field.focus();
    field.select();
    notice("Select Copy from the text menu.");
  }

  async function shareSeed() {
    const { record } = currentResult;
    if (!record) return;
    const url = seedLink(location.href, record);
    if (navigator.share) {
      try {
        await navigator.share({ title: PRESETS[record.game].label + " seed", url });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    if (await copyText(url)) {
      notice("Seed link copied.");
      return;
    }
    byId("share-url").value = url;
    byId("share-dialog").showModal();
    byId("share-url").select();
  }

  function finishTap() {
    clearTimeout(tapTimer);
    pendingKey = "";
    byId("phone-keys").querySelector("[data-pending]")?.removeAttribute("data-pending");
  }

  function renderPhone() {
    byId("phone-text").value = phoneKeyword;
    byId("use-keyword").disabled = !phoneKeyword;
  }

  function tapKey(key, button) {
    const letters = KEYMAP[key];
    if (pendingKey === key) {
      const next = (letters.indexOf(phoneKeyword.at(-1)) + 1) % letters.length;
      phoneKeyword = phoneKeyword.slice(0, -1) + letters[next];
    } else {
      phoneKeyword += letters[0];
    }
    finishTap();
    pendingKey = key;
    button.setAttribute("data-pending", "");
    tapTimer = setTimeout(finishTap, 750);
    renderPhone();
  }

  function keypadAction(action) {
    finishTap();
    if (action === "clear") phoneKeyword = "";
    if (action === "space") phoneKeyword += " ";
    if (action === "backspace") phoneKeyword = phoneKeyword.slice(0, -1);
    renderPhone();
  }

  function buildKeypad() {
    const keys = ["next", ...Object.keys(KEYMAP), "clear", "space", "backspace"];
    const label = { next: "Next", clear: "Clear", space: "Space", backspace: "Backspace" };
    for (const key of keys) {
      const button = document.createElement("button");
      button.type = "button";
      if (KEYMAP[key]) {
        const digit = document.createElement("strong");
        digit.textContent = key;
        const letters = document.createElement("small");
        letters.textContent = KEYMAP[key];
        button.append(digit, letters);
        button.addEventListener("click", () => tapKey(key, button));
      } else {
        button.textContent = key === "backspace" ? "⌫" : label[key];
        button.setAttribute("aria-label", label[key]);
        button.addEventListener("click", () => keypadAction(key));
      }
      byId("phone-keys").append(button);
    }
  }

  gameSelect.addEventListener("change", () => {
    useGame(gameSelect.value);
    recovery = null;
    decodeMethod = "game";
    readingPage = 0;
    writeStorage(gameKey, game);
    refresh();
  });
  byId("explain-method").addEventListener("click", explainMethod);
  byId("encode-key").addEventListener("click", editKey);
  byId("decode-key").addEventListener("click", editKey);
  byId("key-form").addEventListener("submit", applyKey);
  byId("key-input").addEventListener("input", () => {
    byId("copy-key").disabled = !byId("key-input").value;
  });
  byId("generate-key").addEventListener("click", () => {
    const random = crypto.getRandomValues(new Uint8Array(8));
    byId("key-input").value = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
    byId("copy-key").disabled = false;
  });
  byId("copy-key").addEventListener("click", async () => {
    const input = byId("key-input");
    const copied = await copyText(input.value);
    byId("key-note").textContent = copied ? "Key copied." : "Select the key field to copy it.";
    if (!copied) input.select();
  });
  byId("choose-seed").addEventListener("click", chooseSeed);
  byId("next-variation").addEventListener("click", nextVariation);
  byId("recover-saved").addEventListener("click", () => openSeed(currentResult.record, true));
  byId("reading-previous").addEventListener("click", () => { readingPage--; refresh(); });
  byId("reading-next").addEventListener("click", () => { readingPage++; refresh(); });
  byId("all-readings").addEventListener("click", () => {
    decodeMethod = "game";
    refresh();
    byId("reading-list").querySelector("button")?.focus({ preventScroll: true });
  });

  methodSelect.addEventListener("change", () => {
    encodeMethod = methodSelect.value;
    encodeVariation = undefined;
    refresh();
  });

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      if (tab.dataset.tab === "decode") decodeMethod = "game";
      navigate(tab.dataset.tab);
    });
  }
  for (const button of collectionButtons) {
    button.addEventListener("click", () => {
      if (collection !== button.dataset.collection) libraryIndex = 0;
      collection = button.dataset.collection;
      refresh();
    });
  }
  keywordInput.addEventListener("input", () => {
    rolledSeeds.clear();
    refresh();
  });
  seedInput.addEventListener("input", () => {
    const entry = readSeedLink(seedInput.value, location.href);
    if (entry) {
      seedInput.blur();
      openSeed(entry);
      return;
    }
    if (recovery?.seed !== seedInput.value) recovery = null;
    if (/^[~!+][0-9A-Za-z]{9}$/.test(seedInput.value) &&
        (game === "none" || PRESETS[game].validate(seedInput.value))) useGame("valheim");
    readingPage = 0;
    decodeMethod = "game";
    refresh();
  });
  for (const field of [keywordInput, seedInput]) {
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) field.blur();
    });
  }
  for (const button of document.querySelectorAll("[data-done]")) {
    button.addEventListener("click", () => byId(button.dataset.done).blur());
  }
  for (const select of [terrainSelect, sizeSelect]) select.addEventListener("change", refresh);
  byId("roll").addEventListener("click", () => {
    seedInput.blur();
    recovery = null;
    seedInput.value = PRESETS[game].roll(crypto);
    readingPage = 0;
    decodeMethod = "game";
    refresh();
  });
  byId("previous").addEventListener("click", () => { libraryIndex--; refresh(); });
  byId("next").addEventListener("click", () => { libraryIndex++; refresh(); });
  byId("copy").addEventListener("click", copyResult);
  byId("save").addEventListener("click", toggleSave);
  byId("share").addEventListener("click", shareSeed);
  byId("use-keyword").addEventListener("click", () => {
    finishTap();
    keywordInput.value = phoneKeyword;
    rolledSeeds.clear();
    navigate("encode");
  });
  window.addEventListener("storage", (event) => {
    if (event.key === savedKey || event.key === null) {
      saved = readSaved();
      refresh();
    }
  });

  const app = byId("app");
  const viewport = window.visualViewport;
  function fitViewport() {
    if (viewport && viewport.scale === 1) {
      app.style.setProperty("--app-height", Math.floor(viewport.height) + "px");
    }
    app.toggleAttribute("data-typing", [keywordInput, seedInput].includes(document.activeElement));
    if (view === "decode" && decodeMethod === "game" && seedInput.value &&
        readingLimit !== readingsPerPage()) render();
  }
  viewport?.addEventListener("resize", fitViewport);
  window.addEventListener("resize", fitViewport);
  document.addEventListener("focusin", fitViewport);
  document.addEventListener("focusout", () => requestAnimationFrame(fitViewport));

  buildKeypad();
  fitViewport();
  render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Offline setup failed", error);
    });
  }
})();
