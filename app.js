"use strict";

(() => {
  const { KEYMAP, METHODS, PRESETS, matchingMethods, matchesReading, caseReadings, canonicalSeed, methodInput } = SeedTools;
  const byId = (id) => document.getElementById(id);
  const app = byId("app");
  const workspace = byId("workspace");
  const gameSelect = byId("game");
  const methodSelect = byId("method");
  const keywordInput = byId("keyword");
  const seedInput = byId("seed-input");
  const keyInput = byId("key-input");
  const resultValue = byId("result-value");
  const recoveryKey = byId("recovery-key");
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const copies = [...document.querySelectorAll("[data-copy]")];
  const gameKey = "meaningful-seeds.game";
  const methodOptions = {
    literal: new Option("As typed", "literal"),
    ...Object.fromEntries(Object.entries(METHODS).map(([id, method]) => [id, new Option(method.label, id)])),
    fit: new Option("Force fit", "fit")
  };
  methodSelect.replaceChildren(...Object.values(methodOptions));

  function preferredGame() {
    try {
      const game = JSON.parse(localStorage.getItem(gameKey));
      if (typeof game === "string" && Object.hasOwn(PRESETS, game)) return game;
    } catch {
      // The picker also works with browser storage disabled.
    }
    return "none";
  }

  let game = preferredGame();
  let view = "encode";
  let encodeMethod;
  let encodeId;
  let encodings = [];
  let encoding;
  let unavailable = new Map();
  let decoding;
  let tracePages = [];
  let traceIndex = 0;
  const rolledSeeds = new Set();
  const keys = { encode: "", decode: "" };
  let readingId;
  let readingPage = 0;
  let readingLimit = 0;
  let phoneKeyword = "";
  let pendingKey = "";
  let tapTimer;

  for (const [id, preset] of Object.entries(PRESETS)) {
    gameSelect.add(new Option(preset.label, id));
  }
  gameSelect.value = game;

  function validateSeed(seed) {
    return PRESETS[game].validate(seed);
  }

  function seedIdentity(seed) {
    return canonicalSeed(game, seed);
  }

  function keepsSpelling(seed, keyword) {
    if (game !== "valheim") return true;
    if (ForceFit.needsRecovery(game, seed)) return false;
    const packet = ForceFit.readPacket(game, seed);
    return packet ? packet.keyword === keyword : !ForceFit.readLegacy(game, seed).olderCode;
  }

  function availableEncodings(keyword) {
    const key = keys.encode;
    const canPack = ForceFit.hasSpace(game);
    const compatible = new Map(matchingMethods(game));
    const direct = [];
    let exactDirect = false;
    const disabled = new Set();
    unavailable = new Map();
    for (const [id, option] of Object.entries(methodOptions)) {
      if (id === "fit") continue;
      const method = compatible.get(id);
      if (id !== "literal" && !method) {
        disabled.add(id);
        unavailable.set(id, METHODS[id].usesSeparators
          ? "Requires a seed format that accepts dashes."
          : "Requires a seed format with letters.");
      } else if (keyword) {
        const value = id === "literal" ? keyword : method.encode(keyword) || (method.reversible ? keyword : "");
        const stored = seedIdentity(value);
        const restored = method && stored
          ? method.decode(methodInput(game, id, stored)) || (method.reversible ? stored : "")
          : stored;
        const normalization = stored !== value ? "The game stores " + JSON.stringify(stored) + ". " : "";
        const error = !value ? "This method has no seed for this keyword."
          : validateSeed(value)
          || (!matchesReading(method, restored, keyword)
            ? normalization + "Decodes as " + (restored ? JSON.stringify(restored) : "no text") + "." : "")
          || (id !== "literal" && !keepsSpelling(value, keyword) ? "The result is reserved for a packed Valheim seed." : "");
        if (error) unavailable.set(id, error);
        else {
          direct.push({ id, method: id, value, label: option.text });
          exactDirect ||= restored === keyword;
        }
      }
    }

    if (!canPack) {
      disabled.add("fit");
      unavailable.set("fit", "Choose a game with a defined seed format.");
    }
    const packed = ForceFit.encodeVariants(game, keyword, key).filter(({ seed }) => !validateSeed(seed))
      .map((recipe) => ({
        id: "fit-" + recipe.number, method: "fit", value: recipe.seed, label: SeedTrace.fitLabel(recipe)
      }));
    if (keyword && canPack && !packed.length && (key || encodeMethod === "fit" || !exactDirect)) {
      packed.push(...ForceFit.encodeRecovery(game, keyword).filter(({ seed }) => !validateSeed(seed))
        .map(({ seed, key }, index) => ({
          id: "recovery-" + index, method: "fit", value: seed, key, label: "Force fit · seed + r1 key"
        })));
    }
    if (keyword && canPack && !packed.length) unavailable.set("fit", "The keyword exceeds this game’s packed seed space.");
    return {
      disabled,
      choices: [...direct.filter(({ id }) => id === "literal"), ...packed, ...direct.filter(({ id }) => id !== "literal")]
    };
  }

  function renderEncoding() {
    const keyword = keywordInput.value;
    const { choices, disabled } = availableEncodings(keyword);
    const selectedMethod = disabled.has(encodeMethod) ? undefined : encodeMethod;
    encoding = selectedMethod
      ? choices.find(({ id, method }) => id === encodeId && method === selectedMethod)
        ?? choices.find(({ method }) => method === selectedMethod)
      : choices[0];
    encodeId = encoding?.id;
    const rollChoices = keys.encode && ForceFit.hasSpace(game)
      ? choices.filter(({ method }) => method === "fit") : choices;
    encodings = [...new Map(rollChoices.map((choice) => [seedIdentity(choice.value), choice])).values()];
    for (const [id, option] of Object.entries(methodOptions)) {
      option.disabled = disabled.has(id);
      option.title = unavailable.get(id) ?? "";
    }
    methodOptions.fit.text = encoding?.method === "fit" ? encoding.label : "Force fit";
    const fallback = Object.keys(methodOptions).find((id) => !disabled.has(id));
    methodSelect.value = selectedMethod ?? encoding?.method ?? fallback ?? "";
    const current = seedIdentity(encoding?.value ?? "");
    byId("choose-seed").disabled = !encodings.some(({ value }) => seedIdentity(value) !== current);
    byId("value-row").hidden = false;
    byId("result-label").textContent = "Seed";
    resultValue.value = encoding?.value ?? "";
    recoveryKey.value = encoding?.key ?? "";
    byId("recovery-row").hidden = !recoveryKey.value;
    setStatus(keyword && !encoding ? unavailable.get(methodSelect.value) ?? "Check the keyword." : "");
    showMap(resultValue.value);
  }

  function chooseSeed() {
    const current = seedIdentity(encoding?.value ?? "");
    const alternatives = encodings.filter(({ value }) => seedIdentity(value) !== current);
    if (!alternatives.length) return;
    rolledSeeds.add(current);
    let pool = alternatives.filter(({ value }) => !rolledSeeds.has(seedIdentity(value)));
    if (!pool.length) {
      rolledSeeds.clear();
      pool = alternatives;
    }
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    rolledSeeds.add(seedIdentity(chosen.value));
    encodeMethod = chosen.method;
    encodeId = chosen.id;
    keywordInput.blur();
    render();
  }

  function decode(seed, formatError) {
    if (!seed) return {};
    const key = keys.decode;
    const literal = formatError ? [] : [{ id: "literal", label: "As typed", value: seed }];
    const recovered = ForceFit.recoveryGame(key) === game ? ForceFit.readRecovery(seed, key) : null;
    if (recovered !== null) {
      return {
        result: { id: "recovery", kind: "recovery", label: "Force fit · seed + r1 key", value: recovered },
        readings: literal
      };
    }

    const packet = ForceFit.readPacket(game, seed, key);
    if (packet?.status === "decoded" && game === "valheim") {
      return {
        result: { id: "fit", kind: "packet", label: SeedTrace.fitLabel(packet), value: packet.keyword },
        readings: literal
      };
    }
    if (ForceFit.needsRecovery(game, seed)) {
      return { kind: "recovery", error: key ? "Check seed and key." : "Key required.", readings: literal };
    }
    if (packet?.status === "key-needed") return { kind: "packet", error: "Key required.", readings: literal };
    if (packet?.status === "key-mismatch") return { kind: "packet", error: "Check seed and key.", readings: literal };
    if (packet?.status === "copy-check") return { kind: "packet", error: "Check the seed.", readings: literal };

    const older = packet ? null : ForceFit.readLegacy(game, seed);
    if (older?.olderCode) return { kind: "legacy", error: "Older short code. No keyword.", readings: literal };
    const readings = [...literal];
    if (packet) readings.unshift({ id: "fit", kind: "packet", label: SeedTrace.fitLabel(packet), value: packet.keyword });
    for (const { variant, keyword } of older?.readings ?? []) {
      readings.push({ id: "older-" + variant, kind: "legacy", variant, label: "Older Force fit " + (variant + 1), value: keyword });
    }
    const methods = matchingMethods(game);
    methods.sort(([, left], [, right]) => Number(Boolean(right.reversible)) - Number(Boolean(left.reversible)));
    for (const [id, method] of methods) {
      const value = method.decode(methodInput(game, id, seed));
      if (!value) continue;
      caseReadings(method, value).forEach((reading, index) => {
        readings.push({ id: index ? id + "-" + index : id, method: id, label: method.label, value: reading });
      });
    }
    const kind = !packet && ForceFit.recoveryGame(key) === game ? "recovery" : undefined;
    return { kind, readings, error: key && !packet?.keyed ? "Check seed and key." : "" };
  }

  function readingsPerPage() {
    const height = app.clientHeight;
    if (height <= 355) return app.clientWidth >= 530 ? 2 : 1;
    if (height <= 495) return 2;
    if (height <= 590) return 3;
    return 4;
  }

  function renderReadings(readings) {
    const list = byId("reading-list");
    readingLimit = readingsPerPage();
    const pages = Math.ceil(readings.length / readingLimit);
    readingPage = Math.min(readingPage, pages - 1);
    byId("reading-page").value = (readingPage + 1) + " / " + pages;
    byId("reading-pager").hidden = pages === 1;
    byId("reading-previous").disabled = readingPage === 0;
    byId("reading-next").disabled = readingPage >= pages - 1;

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
        readingId = id;
        render();
        byId("all-readings").focus({ preventScroll: true });
      });
      return button;
    });
    list.replaceChildren(...buttons);
  }

  function renderDecoding() {
    const seed = seedInput.value;
    const formatError = seed ? validateSeed(seed) : "";
    const { result, kind, readings = [], error } = decode(seed, formatError);
    const choices = result && readings.length ? [result, ...readings] : readings;
    const selected = choices.find(({ id }) => id === readingId);
    const active = readingId === undefined ? result : selected;
    const showReadings = !active && choices.length > 0;
    const value = active?.value ?? "";
    decoding = { kind, error: formatError || error, active, readings: choices };
    byId("explain-decoding").disabled = !seed;
    seedInput.inputMode = PRESETS[game].numeric ? "numeric" : "text";
    byId("value-row").hidden = !value;
    byId("result-label").textContent = selected && selected !== result ? "Possible keyword" : "Keyword";
    resultValue.value = value;
    byId("all-readings").hidden = !active || !choices.length;
    byId("readings").hidden = !showReadings;
    if (showReadings) renderReadings(choices);
    setStatus(formatError || (!value ? error : ""));
    showMap(seed);
  }

  function setStatus(message) {
    const status = byId("result-status");
    status.textContent = message ?? "";
    status.hidden = !message;
  }

  function showMap(seed) {
    const map = byId("map");
    map.hidden = game !== "valheim" || !seed || Boolean(validateSeed(seed));
    if (!map.hidden) {
      const heading = byId(view === "encode" ? "result-heading" : "decode-heading");
      if (map.parentElement !== heading) heading.append(map);
      const url = new URL("https://m.valheim-map.world/");
      url.searchParams.set("seed", seed);
      map.href = url.href;
    }
  }

  function updateCopyButtons() {
    for (const button of copies) {
      const input = byId(button.dataset.copy);
      button.disabled = !input.value || (input === seedInput && Boolean(validateSeed(input.value)));
      button.removeAttribute("data-copied");
    }
    const copyResult = copies.find(({ dataset }) => dataset.copy === "result-value");
    copyResult.setAttribute("aria-label", view === "encode" ? "Copy seed" : "Copy keyword");
  }

  function render() {
    workspace.dataset.view = view;
    for (const tab of tabs) {
      const active = tab.dataset.tab === view;
      byId(tab.dataset.tab + "-panel").hidden = !active;
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    byId("result").hidden = view === "keypad";
    byId("method-row").hidden = view !== "encode";
    byId("explain-method").hidden = view !== "encode";
    byId("all-readings").hidden = true;
    byId("readings").hidden = true;
    byId("recovery-row").hidden = true;
    byId("roll").hidden = !PRESETS[game].roll;
    byId("encode-key").hidden = !ForceFit.hasSpace(game);
    if (view === "keypad") {
      renderPhone();
      return;
    }
    if (view === "encode") renderEncoding();
    else renderDecoding();
    const keyButton = byId(view + "-key");
    const usesEnteredKey = view === "decode" || (methodSelect.value === "fit" && !encoding?.key);
    keyButton.toggleAttribute("data-key", Boolean(keys[view]) && usesEnteredKey);
    keyButton.setAttribute("aria-label", keys[view] ? "Change secret key" : "Secret key");
    updateCopyButtons();
  }

  function navigate(nextView) {
    if (view !== nextView) document.activeElement?.blur();
    view = nextView;
    workspace.scrollTop = 0;
    render();
  }

  function useGame(format) {
    game = format;
    gameSelect.value = game;
    encodeMethod = keys.encode && ForceFit.hasSpace(game) ? "fit" : undefined;
    encodeId = undefined;
    rolledSeeds.clear();
  }

  function resetDecoding() {
    readingId = undefined;
    readingPage = 0;
  }

  function detectGame() {
    const seed = seedInput.value;
    const key = keys.decode;
    const format = ForceFit.recoveryGame(key);
    if (format && format !== game && ForceFit.readRecovery(seed, key) !== null) useGame(format);
    else if (/^[~!+*][0-9A-Za-z]{9}$/.test(seed) && (game === "none" || PRESETS[game].validate(seed))) {
      useGame("valheim");
    }
  }

  function tracePacked(kind, seed, key, reverse, variant) {
    const trace = ForceFit.inspect(kind, game, seed, key, variant);
    if (!trace) return [SeedTrace.page("Check the seed", "The seed or key does not match this format.", [])];
    if (kind === "packet") return SeedTrace.packetPages(trace, reverse);
    if (kind === "recovery") return SeedTrace.recoveryPages(trace, reverse);
    return SeedTrace.legacyPages(trace);
  }

  function traceEncoding() {
    if (!encoding) {
      const id = methodSelect.value;
      const keyword = keywordInput.value;
      const attempted = id === "literal" ? keyword : METHODS[id]?.encode(keyword);
      const pages = [keyword
        ? SeedTrace.page("Seed unavailable", unavailable.get(id) ?? "Check the keyword.",
          attempted ? [["Attempted seed", JSON.stringify(attempted)]] : [])
        : SeedTrace.page("Keyword", "Enter a keyword to see the calculation.", [])];
      if (attempted) pages.push(...SeedTrace.direct(id, keyword, attempted, false, game));
      return { label: methodOptions[id]?.text ?? "Methods", pages };
    }
    const { id, method, value, key, label } = encoding;
    const kind = key ? "recovery" : method === "fit" ? "packet" : null;
    if (kind) return { label, kind, pages: tracePacked(kind, value, key ?? keys.encode, false) };
    const pages = SeedTrace.direct(id, keywordInput.value, value, false, game);
    if (keys.encode && ForceFit.hasSpace(game)) pages[0].note += " The entered secret key applies to Force fit.";
    return { label, pages };
  }

  function traceDecoding() {
    const { active, error, readings } = decoding;
    const seed = seedInput.value;
    const kind = active ? active.kind : decoding.kind;
    if (kind) {
      return { label: active?.label ?? "Force fit", kind, pages: tracePacked(kind, seed, keys.decode, true, active?.variant) };
    }
    if (active) return { label: active.label, pages: SeedTrace.direct(active.method ?? active.id, active.value, seed, true, game) };
    return { label: "Readings", pages: [SeedTrace.page("Seed",
      readings.length ? "Choose a reading to see its calculation. A seed can have several readings."
        : error || "No reading matches this seed.",
      [["Input", JSON.stringify(seed)], ["Possible readings", readings.length]])] };
  }

  function renderTrace() {
    const { title, note, rows } = tracePages[traceIndex];
    byId("trace-title").textContent = title;
    byId("trace-note").textContent = note;
    const values = rows.flatMap(([name, value]) => {
      const term = document.createElement("dt");
      term.textContent = name;
      const description = document.createElement("dd");
      const code = document.createElement("code");
      code.textContent = String(value);
      description.append(code);
      return [term, description];
    });
    byId("trace-rows").replaceChildren(...values);
    byId("trace-body").scrollTop = 0;
    byId("trace-prev").disabled = traceIndex === 0;
    byId("trace-next").disabled = traceIndex >= tracePages.length - 1;
    byId("trace-pager").hidden = tracePages.length <= 1;
    byId("trace-page").value = (traceIndex + 1) + " / " + tracePages.length;
  }

  function explainMethod() {
    const { label, kind, pages } = view === "encode" ? traceEncoding() : traceDecoding();
    tracePages = pages;
    if (view === "encode") {
      const blocked = [...unavailable].map(([id, reason]) => [id === "fit" ? "Force fit" : methodOptions[id].text, reason]);
      for (let i = 0; i < blocked.length; i += 4) {
        tracePages.push(SeedTrace.page("Method constraints", PRESETS[game].label, blocked.slice(i, i + 4)));
      }
    }
    traceIndex = 0;
    byId("method-title").textContent = label;
    const source = kind ? "force-fit.js" : "seed-core.js";
    byId("trace-source").href = document.querySelector('script[src^="' + source + '"]').src;
    renderTrace();
    byId("method-dialog").showModal();
  }

  function editKey() {
    keyInput.value = keys[view];
    byId("generate-key").hidden = view !== "encode";
    updateCopyButtons();
    byId("key-dialog").showModal();
  }

  function applyKey(event) {
    event.preventDefault();
    keys[view] = keyInput.value;
    if (view === "encode") {
      if (keys.encode) encodeMethod = "fit";
      encodeId = undefined;
      rolledSeeds.clear();
    } else {
      detectGame();
      resetDecoding();
    }
    byId("key-dialog").close();
    render();
  }

  async function copyText(text) {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // A selected field works in some embedded browsers.
      }
    }

    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true;
    field.className = "clipboard";
    const focused = document.activeElement;
    (focused?.closest("dialog") ?? document.body).append(field);
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

  async function copyValue(button) {
    const input = byId(button.dataset.copy);
    const value = input.value;
    if (!value) return;
    const copied = await copyText(value);
    if (input.value !== value) return;
    const status = byId(input === keyInput ? "key-copy-status" : "copy-status");
    status.textContent = copied ? "Copied." : "Select Copy.";
    if (copied) {
      button.setAttribute("data-copied", "");
      setTimeout(() => button.removeAttribute("data-copied"), 1200);
    } else {
      input.focus();
      input.select();
    }
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
    resetDecoding();
    try {
      localStorage.setItem(gameKey, JSON.stringify(game));
    } catch {
      // The current selection is still applied.
    }
    render();
  });
  methodSelect.addEventListener("change", () => {
    if (methodSelect.selectedOptions[0] && !methodSelect.selectedOptions[0].disabled) {
      encodeMethod = methodSelect.value;
      encodeId = undefined;
    }
    render();
  });
  byId("explain-method").addEventListener("click", explainMethod);
  byId("explain-decoding").addEventListener("click", explainMethod);
  byId("trace-prev").addEventListener("click", () => { traceIndex--; renderTrace(); });
  byId("trace-next").addEventListener("click", () => { traceIndex++; renderTrace(); });
  byId("encode-key").addEventListener("click", editKey);
  byId("decode-key").addEventListener("click", editKey);
  byId("key-form").addEventListener("submit", applyKey);
  keyInput.addEventListener("input", updateCopyButtons);
  byId("generate-key").addEventListener("click", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    keyInput.value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    updateCopyButtons();
  });
  for (const button of copies) button.addEventListener("click", () => copyValue(button));

  byId("choose-seed").addEventListener("click", chooseSeed);
  byId("reading-previous").addEventListener("click", () => { readingPage--; render(); });
  byId("reading-next").addEventListener("click", () => { readingPage++; render(); });
  byId("all-readings").addEventListener("click", () => {
    readingId = null;
    render();
    byId("reading-list").querySelector("button")?.focus({ preventScroll: true });
  });
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      if (tab.dataset.tab === "decode") resetDecoding();
      navigate(tab.dataset.tab);
    });
  }
  keywordInput.addEventListener("input", () => {
    rolledSeeds.clear();
    render();
  });
  seedInput.addEventListener("input", () => {
    detectGame();
    resetDecoding();
    render();
  });
  for (const field of [keywordInput, seedInput]) {
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        field.blur();
      }
    });
  }
  for (const button of document.querySelectorAll("[data-done]")) {
    button.addEventListener("click", () => byId(button.dataset.done).blur());
  }
  byId("roll").addEventListener("click", () => {
    seedInput.blur();
    seedInput.value = PRESETS[game].roll(crypto);
    resetDecoding();
    render();
  });
  byId("use-keyword").addEventListener("click", () => {
    finishTap();
    keywordInput.value = phoneKeyword;
    rolledSeeds.clear();
    navigate("encode");
  });

  const viewport = window.visualViewport;
  function fitViewport() {
    if (viewport && viewport.scale === 1) {
      app.style.setProperty("--app-height", Math.floor(viewport.height) + "px");
    }
    app.toggleAttribute("data-typing", [keywordInput, seedInput].includes(document.activeElement));
    if (view === "decode" && !byId("readings").hidden && readingLimit !== readingsPerPage()) render();
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
