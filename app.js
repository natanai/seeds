"use strict";

(() => {
  const { KEYMAP, MAP_TYPES, MAP_SIZES, METHODS, PRESETS, makeSeed, seedKey, seedLink } = SeedTools;
  const byId = (id) => document.getElementById(id);
  const gameSelect = byId("game");
  const methodSelect = byId("method");
  const terrainSelect = byId("terrain");
  const sizeSelect = byId("map-size");
  const phraseInput = byId("phrase");
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
  let encodeMethod = PRESETS[game].encode ? "phrase" : "mtap";
  let decodeMethod = search.has("seed") || game !== "none" ? "game" : "mtap";
  let saved = readSaved();
  let collection = saved.some((entry) => game === "none" || entry.game === game)
    ? "saved" : "examples";
  let libraryIndex = 0;
  let currentResult = {};
  let phonePhrase = "";
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

  function getCandidates() {
    const encoding = view === "encode";
    const input = encoding ? phraseInput.value : seedInput.value;
    const preset = PRESETS[game];
    const candidates = Object.entries(METHODS).map(([id, method]) => {
      const value = method[view](input);
      const candidate = { id, label: method.label, value, error: "", hint: method.hint };
      if (!input) return candidate;
      if (encoding) {
        candidate.error = value ? preset.validate(value) : "No characters usable with this method.";
        if (value) candidate.hint = fitsPreset() || method.hint;
      } else if (!value) {
        candidate.error = method.invalid;
      }
      return candidate;
    });

    if (encoding && preset.encode) {
      const hint = game === "valheim"
        ? "Up to 10 characters. Longer phrases get a fixed code."
        : "The same phrase gives the same map seed.";
      candidates.unshift({ id: "phrase", label: "Phrase seed", value: preset.encode(input), hint });
    }
    if (!encoding) {
      candidates.unshift({
        id: "game", label: "Game seed", value: input,
        error: input ? preset.validate(input) : "",
        hint: input ? fitsPreset() : "Paste a seed to check its format."
      });
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
      example?.description
    ].filter(Boolean);
    renderResult({
      value: entry.seed, label: example?.title ?? "Seed", note: details.join(" · "),
      record, source: example?.source
    });
  }

  function renderResult({
    value = "", label = "Seed", note = "", error = "", record = null, source,
    showValue = true, seedActions = true, actions = true
  }) {
    currentResult = { value, label, record, showValue };
    byId("value-row").hidden = !showValue;
    byId("result-label").textContent = label;
    resultValue.value = value;
    resultStatus.textContent = error || note;
    resultStatus.dataset.invalid = String(Boolean(error));
    resultStatus.parentElement.hidden = !error && !note && !source;

    const sourceLink = byId("source");
    sourceLink.hidden = !source;
    if (source) sourceLink.href = source;

    byId("copy").parentElement.hidden = !actions;
    byId("copy").disabled = !value;
    byId("copy").textContent = label === "Decoded text" ? "Copy text" : "Copy";
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
    const decodingGameSeed = view === "decode" && decodeMethod === "game";
    byId("workspace").dataset.view = view;
    for (const tab of tabs) {
      const active = tab.dataset.tab === view;
      byId(tab.dataset.tab + "-panel").hidden = !active;
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    byId("result").hidden = view === "keypad";
    byId("method-row").hidden = view === "seeds";
    byId("map-settings").hidden = game !== "going-medieval" ||
      (view !== "encode" && !decodingGameSeed);
    byId("roll").hidden = !PRESETS[game].roll;
    const inputMode = decodingGameSeed && PRESETS[game].numeric ? "numeric" : "text";
    if (seedInput.inputMode !== inputMode) seedInput.inputMode = inputMode;

    if (view === "keypad") {
      renderPhone();
      return;
    }
    if (view === "seeds") {
      renderLibrary();
      return;
    }

    const candidates = getCandidates();
    const method = view === "encode" ? encodeMethod : decodeMethod;
    setOptionLabels(candidates, method);
    const { value, error, hint } = candidates.find(({ id }) => id === method);
    const seedActions = view === "encode" || decodingGameSeed;
    const record = seedActions && !error ? makeSeed(game, value, settings()) : null;
    renderResult({
      value, error, note: hint, record, seedActions, showValue: !decodingGameSeed,
      label: seedActions ? "Seed" : "Decoded text"
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
    byId("phone-text").value = phonePhrase;
    byId("use-phrase").disabled = !phonePhrase;
  }

  function tapKey(key, button) {
    const letters = KEYMAP[key];
    if (pendingKey === key) {
      const next = (letters.indexOf(phonePhrase.at(-1)) + 1) % letters.length;
      phonePhrase = phonePhrase.slice(0, -1) + letters[next];
    } else {
      phonePhrase += letters[0];
    }
    finishTap();
    pendingKey = key;
    button.setAttribute("data-pending", "");
    tapTimer = setTimeout(finishTap, 750);
    renderPhone();
  }

  function keypadAction(action) {
    finishTap();
    if (action === "clear") phonePhrase = "";
    if (action === "space") phonePhrase += " ";
    if (action === "backspace") phonePhrase = phonePhrase.slice(0, -1);
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
    encodeMethod = PRESETS[game].encode ? "phrase" : "mtap";
    decodeMethod = game === "none" ? "mtap" : "game";
    libraryIndex = 0;
    writeStorage(gameKey, game);
    refresh();
  });

  methodSelect.addEventListener("change", () => {
    if (view === "encode") encodeMethod = methodSelect.value;
    if (view === "decode") decodeMethod = methodSelect.value;
    refresh();
  });

  for (const tab of tabs) {
    tab.addEventListener("click", () => navigate(tab.dataset.tab));
  }
  for (const button of collectionButtons) {
    button.addEventListener("click", () => {
      if (collection !== button.dataset.collection) libraryIndex = 0;
      collection = button.dataset.collection;
      refresh();
    });
  }
  for (const field of [phraseInput, seedInput]) {
    field.addEventListener("input", refresh);
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
    seedInput.value = PRESETS[game].roll(crypto);
    decodeMethod = "game";
    refresh();
  });
  byId("previous").addEventListener("click", () => { libraryIndex--; refresh(); });
  byId("next").addEventListener("click", () => { libraryIndex++; refresh(); });
  byId("copy").addEventListener("click", copyResult);
  byId("save").addEventListener("click", toggleSave);
  byId("share").addEventListener("click", shareSeed);
  byId("use-phrase").addEventListener("click", () => {
    finishTap();
    phraseInput.value = phonePhrase;
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
    app.toggleAttribute("data-typing", [phraseInput, seedInput].includes(document.activeElement));
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
