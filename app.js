"use strict";

(() => {
  const { KEYMAP, FAMILIES, PRESETS, canonicalSeed, inspectEncodings, inspectDecodings } = SeedTools;
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
  let activeReading;
  let readingPage = 0n;
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
    const pageSize = BigInt(readingLimit);
    const pages = (readings.count + pageSize - 1n) / pageSize;
    if (readingPage >= pages) readingPage = pages - 1n;
    byId("reading-page").value = (readingPage + 1n) + " / " + pages;
    byId("reading-pager").hidden = pages === 1n;
    byId("reading-previous").disabled = readingPage === 0n;
    byId("reading-next").disabled = readingPage >= pages - 1n;

    const first = readingPage * pageSize;
    const buttons = [];
    for (let index = first; index < first + pageSize && index < readings.count; index++) {
      const reading = readings.at(index);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reading";
      const name = document.createElement("span");
      name.textContent = reading.label;
      const keyword = document.createElement("code");
      keyword.textContent = reading.value;
      button.append(name, keyword);
      button.addEventListener("click", () => {
        activeReading = reading;
        render();
        byId("all-readings").focus({ preventScroll: true });
      });
      buttons.push(button);
    }
    list.replaceChildren(...buttons);
  }

  function renderDecoding() {
    const seed = seedInput.value;
    decoding = inspectDecodings(game, seed);
    const showReadings = !activeReading && decoding.count > 0n;
    const value = activeReading?.value ?? "";
    byId("explain-decoding").disabled = !seed;
    seedInput.inputMode = PRESETS[game].numeric ? "numeric" : "text";
    byId("value-row").hidden = !value;
    byId("result-label").textContent = "Possible keyword";
    resultValue.value = value;
    byId("all-readings").hidden = !activeReading;
    byId("readings").hidden = !showReadings;
    if (showReadings) renderReadings(decoding);
    setStatus(decoding.formatError);
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
    activeReading = undefined;
    readingPage = 0n;
  }

  function tracePacked(seed, reverse, variant) {
    return SeedTrace.packedPages(PackedText.inspect(game, seed, variant), reverse);
  }

  function traceEncoding() {
    const keyword = keywordInput.value;
    if (!encoding) {
      const { id, family, label, message, attempted } = encodingFailure();
      const kind = family === "packed" ? "packed" : undefined;
      const pages = [message && keyword
        ? SeedTrace.page(encodings.length ? "Seed unavailable" : "No encoding fits", message,
          attempted ? [["Attempted seed", JSON.stringify(attempted)]] : [])
        : SeedTrace.page("Keyword", "Enter a keyword to see the calculation.", [])];
      if (!kind && attempted !== undefined) pages.push(...SeedTrace.direct(id, keyword, attempted, false, game));
      return { label: label ?? FAMILIES[methodSelect.value].label, kind, pages };
    }
    const { id, family, value, label, variant } = encoding;
    if (family === "packed") return { label, kind: "packed", pages: tracePacked(value, false, variant) };
    return { label, pages: SeedTrace.direct(id, keyword, value, false, game) };
  }

  function traceDecoding() {
    const { formatError, count } = decoding;
    const seed = seedInput.value;
    const kind = activeReading?.kind;
    const label = activeReading?.label ?? "Readings";
    const pages = kind ? tracePacked(seed, true, activeReading.variant)
      : activeReading ? SeedTrace.direct(activeReading.method, activeReading.value, seed, true, game)
        : [SeedTrace.page("Seed", formatError || (count ? "Choose a reading to see its calculation." : "No reading matches this seed."),
          [["Input", JSON.stringify(seed)], ["Possible readings", count]])];
    if (activeReading && formatError) pages.unshift(SeedTrace.page("Seed unavailable for this game", formatError, [["Seed", JSON.stringify(seed)]]));
    return { label, kind, pages };
  }

  function renderTrace() {
    const { title, note, rows, source } = tracePages[traceIndex];
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
    byId("trace-source").href = source;
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
    const sourceUrl = document.querySelector('script[src^="' + source + '"]').src;
    tracePages = [...tracePages, ...(PRESETS[game].guide ?? [])]
      .map((page) => ({ source: sourceUrl, ...page }));
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
    activeReading = undefined;
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
