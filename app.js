"use strict";

(() => {
  const { KEYMAP, FAMILIES, PRESETS, matchingMethods, caseReadings, canonicalSeed, methodInput,
    inspectEncodings } = SeedTools;
  const byId = (id) => document.getElementById(id);
  const app = byId("app");
  const workspace = byId("workspace");
  const gameSelect = byId("game");
  const methodSelect = byId("method");
  const keywordInput = byId("keyword");
  const seedInput = byId("seed-input");
  const resultValue = byId("result-value");
  const variantLabel = byId("encoding-variant");
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const copies = [...document.querySelectorAll("[data-copy]")];
  const gameKey = "meaningful-seeds.game";
  const methodOptions = Object.fromEntries(Object.entries(FAMILIES)
    .map(([id, { label }]) => [id, new Option(label, id)]));
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
  let encodeFamily;
  let encodeId;
  let encodings = [];
  let encoding;
  let failures = [];
  let decoding;
  let tracePages = [];
  let traceIndex = 0;
  const rolledSeeds = new Set();
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

  function encodingFailure() {
    const family = methodSelect.value;
    const failure = failures.find((attempt) => attempt.family === family && attempt.attempted)
      ?? failures.find((attempt) => attempt.family === family);
    if (!failure) return {};
    const overview = encodings.length ? "" : "No available method fits " + PRESETS[game].label + ". ";
    return { ...failure, message: overview + failure.reason };
  }

  function renderEncoding() {
    const keyword = keywordInput.value;
    const attempts = inspectEncodings(game, keyword);
    failures = attempts.failures;
    const { choices, disabled } = attempts;
    const selected = disabled.has(encodeFamily) ? undefined : encodeFamily;
    encoding = selected
      ? choices.find(({ id, family }) => id === encodeId && family === selected)
        ?? choices.find(({ family }) => family === selected)
      : choices.find(({ family }) => family === "literal")
        ?? choices.find(({ family }) => family === "packed") ?? choices[0];
    encodeId = encoding?.id;

    const distinct = new Map();
    for (const choice of choices) {
      const identity = seedIdentity(choice.value);
      if (!distinct.has(identity)) distinct.set(identity, choice);
    }
    encodings = [...distinct.values()];
    for (const [id, option] of Object.entries(methodOptions)) {
      option.disabled = disabled.has(id);
      option.title = option.disabled ? failures.find(({ family }) => family === id)?.reason ?? "" : "";
    }
    const family = selected ?? encoding?.family ?? "literal";
    methodSelect.value = family;
    const failure = keyword && !encoding ? encodingFailure() : {};
    const variant = encoding?.label ?? failure.label;
    variantLabel.textContent = variant ?? "";
    variantLabel.hidden = !variant || variant === FAMILIES[family].label;

    const dice = byId("choose-seed");
    const current = seedIdentity(encoding?.value ?? "");
    const onlyCurrent = encodings.length === 1 && seedIdentity(encodings[0].value) === current;
    dice.disabled = !keyword || onlyCurrent;
    dice.title = onlyCurrent ? "Only one distinct seed fits." : dice.getAttribute("aria-label");
    byId("value-row").hidden = false;
    byId("result-label").textContent = "Seed";
    resultValue.value = encoding?.value ?? "";
    setStatus(failure.message);
    showMap(resultValue.value);
  }

  function chooseSeed() {
    keywordInput.blur();
    if (!encodings.length) {
      explainMethod();
      return;
    }
    const current = seedIdentity(encoding?.value ?? "");
    const alternatives = encodings.filter(({ value }) => seedIdentity(value) !== current);
    if (!alternatives.length) return;
    rolledSeeds.add(current);
    let pool = alternatives.filter(({ value }) => !rolledSeeds.has(seedIdentity(value)));
    if (!pool.length) {
      rolledSeeds.clear();
      rolledSeeds.add(current);
      pool = alternatives;
    }
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    rolledSeeds.add(seedIdentity(chosen.value));
    encodeFamily = chosen.family;
    encodeId = chosen.id;
    render();
  }

  function decode(seed, formatError) {
    if (!seed) return {};
    const literal = formatError ? [] : [{ id: "literal", label: "As typed", value: seed }];
    const packet = PackedText.readPacket(game, seed);
    if (packet && packet.status !== "decoded") {
      const trace = PackedText.inspect("packet", game, seed);
      return { kind: "packet", error: PackedText.packetError(trace), readings: literal };
    }

    const packed = packet && { id: "packed", kind: "packet", label: "Packed text · " + packet.label, value: packet.keyword };
    if (packed && game === "valheim") return { result: packed, readings: literal };
    const older = packet ? null : PackedText.readLegacy(game, seed);
    if (older?.olderCode) return { kind: "legacy", error: "This older ~ seed stores a hash. The keyword was discarded.", readings: literal };
    const readings = [...literal];
    if (packed) readings.unshift(packed);
    for (const { variant, keyword } of older?.readings ?? []) {
      readings.push({ id: "older-" + variant, kind: "legacy", variant, label: "Older packed text " + (variant + 1), value: keyword });
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
    return { readings };
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
    decoding = { kind, formatError, error: formatError || error, active, readings: choices };
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
    variantLabel.hidden = true;
    byId("roll").hidden = !PRESETS[game].roll;
    if (view === "keypad") {
      renderPhone();
      return;
    }
    if (view === "encode") renderEncoding();
    else renderDecoding();
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
    encodeFamily = undefined;
    encodeId = undefined;
    rolledSeeds.clear();
  }

  function resetDecoding() {
    readingId = undefined;
    readingPage = 0;
  }

  function detectGame() {
    const seed = seedInput.value;
    if (/^[~!][0-9A-Za-z]{9}$/.test(seed) && (game === "none" || validateSeed(seed))) {
      useGame("valheim");
    }
  }

  function tracePacked(kind, seed, reverse, variant, error) {
    const trace = PackedText.inspect(kind, game, seed, variant);
    if (!trace) return [SeedTrace.page("Keyword unavailable", error, [["Seed", JSON.stringify(seed)]])];
    if (kind === "packet") return SeedTrace.packetPages(trace, reverse);
    return SeedTrace.legacyPages(trace);
  }

  function traceEncoding() {
    const keyword = keywordInput.value;
    if (!encoding) {
      const { id, family, label, message, attempted } = encodingFailure();
      const kind = family === "packed" ? "packet" : undefined;
      const pages = [message && keyword
        ? SeedTrace.page(encodings.length ? "Seed unavailable" : "No encoding fits", message,
          attempted ? [["Attempted seed", JSON.stringify(attempted)]] : [])
        : SeedTrace.page("Keyword", "Enter a keyword to see the calculation.", [])];
      if (!kind && attempted !== undefined) pages.push(...SeedTrace.direct(id, keyword, attempted, false, game));
      return { label: label ?? FAMILIES[methodSelect.value].label, kind, pages };
    }
    const { id, family, value, label } = encoding;
    if (family === "packed") return { label, kind: "packet", pages: tracePacked("packet", value, false) };
    return { label, pages: SeedTrace.direct(id, keyword, value, false, game) };
  }

  function traceDecoding() {
    const { active, error, formatError, readings } = decoding;
    const seed = seedInput.value;
    const kind = active ? active.kind : decoding.kind;
    const label = active?.label ?? (kind ? "Packed text" : "Readings");
    const pages = kind ? tracePacked(kind, seed, true, active?.variant, error)
      : active ? SeedTrace.direct(active.method ?? active.id, active.value, seed, true, game)
        : [SeedTrace.page("Seed", error || (readings.length ? "Choose a reading to see its calculation." : "No reading matches this seed."),
          [["Input", JSON.stringify(seed)], ["Possible readings", readings.length]])];
    if (active && formatError) pages.unshift(SeedTrace.page("Seed unavailable for this game", formatError, [["Seed", JSON.stringify(seed)]]));
    return { label, kind, pages };
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
      const blocked = failures.map(({ label, reason }) => [label, reason]);
      for (let i = 0; i < blocked.length; i += 4) {
        tracePages.push(SeedTrace.page("Method constraints", PRESETS[game].label, blocked.slice(i, i + 4)));
      }
    }
    traceIndex = 0;
    byId("method-title").textContent = label;
    const source = kind ? "packed-text.js" : "seed-core.js";
    byId("trace-source").href = document.querySelector('script[src^="' + source + '"]').src;
    renderTrace();
    byId("method-dialog").showModal();
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
    const status = byId("copy-status");
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
      encodeFamily = methodSelect.value;
      encodeId = undefined;
    }
    render();
  });
  byId("explain-method").addEventListener("click", explainMethod);
  byId("explain-decoding").addEventListener("click", explainMethod);
  byId("trace-prev").addEventListener("click", () => { traceIndex--; renderTrace(); });
  byId("trace-next").addEventListener("click", () => { traceIndex++; renderTrace(); });
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
