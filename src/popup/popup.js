'use strict';

/**
 * Toolbar popup: the controls worth reaching for the page you are actually on.
 *
 * It shows one section, chosen from the active tab's URL through the same
 * `pageFromPath` the content script uses, so the popup and the page can never
 * disagree about what kind of page this is.
 *
 * Why page-aware at all: the extension covers three page shapes, and a setting
 * for one of them does nothing visible on the other two. Showing all three at
 * once meant most of the popup was inert wherever it was opened, and the list
 * controls duplicated an in-page toolbar sitting on the same page.
 *
 * What is deliberately NOT here: anything set once and forgotten (fonts,
 * colours, fold patterns, the filter values themselves). Those are a click away
 * on the options page, and putting them here would cost the space that makes
 * the rest scannable. What IS here, besides the obvious per-page controls, are
 * the two ways back out of a page that looks broken: turning filters off, and
 * putting the in-page toolbar back.
 *
 * Reading the tab's URL needs no permission beyond the host permission the
 * extension already has: `tabs.query` fills in `url` for a tab the extension
 * can access, and leaves it undefined for anything else, which is exactly the
 * "not on Royal Road" signal.
 */
(function () {
  const RRX = globalThis.RRX;
  const $ = (id) => document.getElementById(id);

  const boxes = [...document.querySelectorAll('input[type="checkbox"][data-setting]')];
  const sliders = [...document.querySelectorAll('input[type="range"][data-setting]')];
  const selects = [...document.querySelectorAll('select[data-setting]')];
  const sections = [...document.querySelectorAll('section[data-page]')];

  /**
   * Fill every dropdown from the schema, labelled the way the options page
   * labels it. Nothing here restates a vocabulary: a value added to SCHEMA
   * appears, and its wording comes from the same COPY the options page reads.
   */
  for (const select of selects) {
    const key = select.dataset.setting;
    const labels = (RRX.COPY[key] || {}).optionLabels || {};
    for (const value of RRX.SCHEMA[key].values || []) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labels[value] || value;
      select.appendChild(option);
    }
  }

  /** A slider's label: nullable settings read "default" when unset. */
  function sliderLabel(key, value) {
    if (value === null) return 'default';
    return key === 'reader.maxWidthPx' ? `${value}px` : String(value);
  }

  function render({ settings, hidden }) {
    for (const box of boxes) box.checked = !!settings[box.dataset.setting];
    for (const select of selects) select.value = settings[select.dataset.setting];
    $('p-count').textContent = String(RRX.hiddenIds(hidden).length);

    for (const slider of sliders) {
      const key = slider.dataset.setting;
      const value = settings[key];
      // A null (unset) setting leaves the thumb at the low end but the label
      // says "default", so it never looks like a real value was chosen.
      slider.value = value === null ? slider.min : String(value);
      $(`${slider.id}-out`).textContent = sliderLabel(key, value);
    }

    // Mirror the in-page rules: a control whose master switch is off is dead.
    const off = (key) => !settings[key];
    boxes.find((b) => b.dataset.setting === 'hide.showHidden').disabled = off('hide.enabled');
    boxes.find((b) => b.dataset.setting === 'reader.justify').disabled = off('reader.enabled');
    for (const slider of sliders) slider.disabled = off('reader.enabled');
  }

  /**
   * Which section to show. `home` and anything else get the notice: the home
   * page carries fiction cards and so honours hiding, but nothing in here
   * changes it, and a section that cannot act on the page in front of you is
   * worse than saying so.
   */
  async function pageOfActiveTab() {
    try {
      const tabs = await RRX.ext.tabs.query({ active: true, currentWindow: true });
      const url = tabs && tabs[0] && tabs[0].url;
      if (!url) return 'other';
      const parsed = new URL(url);
      if (!/(^|\.)royalroad\.com$/.test(parsed.hostname)) return 'other';
      return RRX.pageFromPath(parsed.pathname);
    } catch {
      // No tabs API, or a tab we are not allowed to see. Either way we cannot
      // claim to know what page this is.
      return 'other';
    }
  }

  function show(page) {
    let shown = false;
    for (const section of sections) {
      const match = section.dataset.page === page;
      section.hidden = !match;
      if (match) shown = true;
    }
    $('p-elsewhere').hidden = shown;
  }

  const refresh = async () => render(await RRX.store.load());

  for (const box of boxes) {
    box.addEventListener('change', async () => {
      await RRX.store.saveSettings({ [box.dataset.setting]: box.checked });
      refresh();
    });
  }

  for (const select of selects) {
    select.addEventListener('change', async () => {
      await RRX.store.saveSettings({ [select.dataset.setting]: select.value });
      refresh();
    });
  }

  for (const slider of sliders) {
    // `input` for live feedback on the label, `change` to commit: otherwise
    // every pixel of drag becomes a storage write.
    slider.addEventListener('input', () => {
      $(`${slider.id}-out`).textContent = sliderLabel(slider.dataset.setting, Number(slider.value));
    });
    slider.addEventListener('change', async () => {
      await RRX.store.saveSettings({ [slider.dataset.setting]: Number(slider.value) });
      refresh();
    });
  }

  $('p-manage').addEventListener('click', () => {
    RRX.ext.runtime.openOptionsPage();
    window.close();
  });

  pageOfActiveTab().then(show);
  refresh();
})();
