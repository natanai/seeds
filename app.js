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
  let encodeMethod = PRESETS[game].keyword ? "keyword" : "mtap";
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

  function keywordCandidate(input, preset) {
    const { seed, prefix, suffix } = preset.keyword(input);
    const explainHash = "FNV-1a starts at 2166136261. For each UTF-8 byte, XOR it in, " +
      "multiply by 16777619 and keep the low 32 bits.";
    const candidate = { id: "keyword", label: "Keyword seed", value: seed, error: "" };

    if (game === "valheim") {
      const rule = "One line of up to " + VALHEIM_LIMIT + " UTF-16 units goes in as typed. Otherwise keep " +
        "the first 3 ASCII letters or digits with case intact. Append the full keyword’s FNV-1a hash in " +
        "uppercase base 36, padded with zeros to 7 characters.";
      const example = suffix ? input.length + " units → " + (prefix ? prefix + " + " : "") + suffix : "";
      candidate.hint = input
        ? (suffix ? "Shortened deterministically. Save or share to recover the keyword." : "Fits Valheim as typed.")
        : "Up to " + VALHEIM_LIMIT + " UTF-16 units go in as typed.";
      candidate.explanation = { rule, math: explainHash, example };
      return candidate;
    }

    candidate.hint = "The same keyword gives the same decimal seed.";
    candidate.explanation = {
      rule: "Hash the full keyword exactly as typed, including case, punctuation and spaces. " +
        "Write the unsigned 32-bit result as decimal.",
      math: explainHash
    };
    return candidate;
  }

  function fitCandidate(input, encoding) {
    const candidate = { id: "fit", label: "Force fit", value: "", error: "" };
    if (!encoding) {
      const packed = ForceFit.decode(game, input);
      candidate.value = packed?.keyword ?? "";
      candidate.error = input && !packed ? "This seed does not match Force fit." : "";
      candidate.hint = packed?.kind === "hash"
        ? "Open this seed’s share link or saved entry to recover its keyword."
        : "Force fit recovers keywords packed into the seed.";
      return candidate;
    }

    const result = ForceFit.encode(game, input);
    const fitRule = "Try packing spaces and a–z first, then UTF-8 bytes. If the keyword exceeds both " +
      "capacities, use a deterministic game seed and keep its exact keyword in Save or Share.";
    if (!result) {
      candidate.hint = "Pack a keyword into this game’s seed format.";
      candidate.explanation = { rule: fitRule };
      return candidate;
    }

    candidate.value = result.seed;
    const example = "Slot " + result.index;
    if (result.kind === "hash") {
      candidate.hint = "Save or share this seed to recover the exact keyword.";
      candidate.explanation = {
        rule: "The keyword exceeds the space for packed text. Start a 64-bit FNV-1a hash at " +
          "14695981039346656037. XOR each UTF-8 byte in, multiply by 1099511628211 and keep 64 bits.",
        math: "Take the remainder modulo " + result.slots + ", then multiply by 3. " + result.format,
        example
      };
      return candidate;
    }

    const compact = result.kind === "compact";
    candidate.hint = "The exact keyword is packed into this seed.";
    candidate.explanation = {
      rule: compact
        ? "Start at 0. For each symbol, multiply by 27 and add its position in space followed by a–z, counting from 1."
        : "Start at 0. For each UTF-8 byte, multiply by 256 and add the byte value plus 1.",
      math: "Subtract 1 from the result, multiply by 3 and add " + (compact ? "1. " : "2. ") + result.format,
      example
    };
    return candidate;
  }

  function getCandidates() {
    const encoding = view === "encode";
    const input = encoding ? keywordInput.value : seedInput.value;
    const preset = PRESETS[game];
    const candidates = matchingMethods(game).map(([id, method]) => {
      const value = method[view](input);
      const candidate = { id, label: method.label, value, error: "", hint: method.hint, reversible: Boolean(method.steps) };
      if (!input) return candidate;
      if (encoding) {
        candidate.error = value ? preset.validate(value) : "No characters usable with this method.";
        if (value) candidate.hint = fitsPreset() || method.hint;
        if (method.steps) candidate.explanation = { rule: method.steps };
      } else if (!value) {
        candidate.error = method.invalid;
      } else {
        candidate.hint = "Open a share link or saved entry for the exact keyword.";
      }
      return candidate;
    });

    if (ForceFit.hasSpace(game)) candidates.unshift(fitCandidate(input, encoding));
    if (encoding && preset.keyword) candidates.unshift(keywordCandidate(input, preset));
    if (!encoding) {
      candidates.unshift({
        id: "game", label: "Game seed", value: input,
        error: input ? preset.validate(input) : "",
        hint: input ? fitsPreset() : "Paste a seed to check it, or a share link to recover its keyword."
      });
      const original = knownKeyword();
      if (original !== undefined) {
        candidates.unshift({
          id: "original", label: "Original keyword", value: original, error: "",
          hint: "Recovered exactly from the seed link or saved entry."
        });
      }
    }
    return candidates;
  }

  function setOptionLabels(candidates, selected) {
    const choices = candidates.map(({ id, label, value, error }) => {
      return { id, label: label + (value && !error ? " ✓" : "") };
    });
    const optionsChanged = choices.length !== methodSelect.options.length ||
      choices.some(({ id, label }, index) => {
        const option = methodSelect.options[index];
        return option.value !== id || option.text !== label;
      });
    if (optionsChanged) {
      methodSelect.replaceChildren(...choices.map(({ id, label }) => new Option(label, id)));
    }
    methodSelect.value = selected;
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
      if (id === "fit" && game === "valheim") return 1;
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
    showValue = true, seedActions = true, actions = true, explanation, allowRecovery = false
  }) {
    currentResult = { value, record, showValue, explanation };
    byId("explain-method").hidden = !explanation;
    byId("recover-saved").hidden = !allowRecovery;
    byId("value-row").hidden = !showValue;
    byId("result-label").textContent = label;
    resultValue.value = value;
    resultStatus.textContent = error || note;
    resultStatus.dataset.invalid = String(Boolean(error));
    resultStatus.parentElement.hidden = !error && !note && !source && !allowRecovery;

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
    const method = encoding ? encodeMethod : decodeMethod;
    const { id, value, error, hint, explanation, label: methodLabel } =
      candidates.find((candidate) => candidate.id === method) ?? candidates[0];
    if (encoding) encodeMethod = id;
    else decodeMethod = id;
    if (encoding) setOptionLabels(candidates, id);

    const gameSeed = id === "game";
    if (gameSeed && seedInput.value) {
      byId("workspace").setAttribute("data-decode-list", "");
      byId("readings").hidden = false;
      renderReadings(candidates);
    }
    if (!encoding && !gameSeed) {
      byId("reading-detail").hidden = false;
      byId("reading-method").textContent = methodLabel;
    }
    const exact = !encoding && (id === "original" || id === "fit");
    const seedActions = encoding || gameSeed || (exact && Boolean(value));
    const inputMode = !encoding && seedActions && PRESETS[game].numeric ? "numeric" : "text";
    if (seedInput.inputMode !== inputMode) seedInput.inputMode = inputMode;
    byId("map-settings").hidden = game !== "going-medieval" || !seedActions;

    const seed = encoding ? value : seedInput.value;
    const keyword = encoding ? keywordInput.value : knownKeyword() ?? (exact ? value : undefined);
    const record = seedActions && !error ? makeSeed(game, seed, { ...settings(), keyword }) : null;
    let label = "Seed";
    if (!encoding && !gameSeed) {
      label = id === "original" ? "Original keyword" : exact ? "Packed keyword" : "Possible reading";
    }
    renderResult({
      value, error, note: hint, record, seedActions, label, explanation,
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

  function openSeed(record, showKeyword = false) {
    if (game !== record.game) {
      game = record.game;
      gameSelect.value = game;
      encodeMethod = PRESETS[game].keyword ? "keyword" : "mtap";
      libraryIndex = 0;
    }
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
    byId("method-math").textContent = explanation.math ?? "";
    byId("method-math").hidden = !explanation.math;
    byId("method-example").textContent = explanation.example ?? "";
    byId("method-example").hidden = !explanation.example;
    byId("method-dialog").showModal();
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
    game = gameSelect.value;
    recovery = null;
    encodeMethod = PRESETS[game].keyword ? "keyword" : "mtap";
    decodeMethod = "game";
    readingPage = 0;
    libraryIndex = 0;
    writeStorage(gameKey, game);
    refresh();
  });
  byId("explain-method").addEventListener("click", explainMethod);
  byId("recover-saved").addEventListener("click", () => openSeed(currentResult.record, true));
  byId("reading-previous").addEventListener("click", () => { readingPage--; refresh(); });
  byId("reading-next").addEventListener("click", () => { readingPage++; refresh(); });
  byId("all-readings").addEventListener("click", () => {
    decodeMethod = "game";
    refresh();
    byId("reading-list").querySelector("button")?.focus({ preventScroll: true });
  });

  methodSelect.addEventListener("change", () => {
    if (view === "encode") encodeMethod = methodSelect.value;
    if (view === "decode") decodeMethod = methodSelect.value;
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
  keywordInput.addEventListener("input", refresh);
  seedInput.addEventListener("input", () => {
    const entry = readSeedLink(seedInput.value, location.href);
    if (entry) {
      seedInput.blur();
      openSeed(entry);
      return;
    }
    if (recovery?.seed !== seedInput.value) recovery = null;
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
