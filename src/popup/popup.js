'use strict';

/**
 * Toolbar popup: the toggles worth reaching mid-read.
 *
 * The reader sliders are here rather than only in the options page because
 * line height and reading width are things you adjust *while* reading, and a
 * Royal Road tab re-applies them live through storage.onChanged, so the effect
 * is visible behind the popup without a reload.
 */
(function () {
  const RRX = globalThis.RRX;
  const $ = (id) => document.getElementById(id);

  const boxes = [...document.querySelectorAll('input[type="checkbox"][data-setting]')];
  const sliders = [...document.querySelectorAll('input[type="range"][data-setting]')];
  const view = $('p-view');

  const VIEW_LABELS = {
    default: 'Cards',
    compact: 'Compact rows',
    'two-col': 'Two columns',
    grid: 'Cover grid',
  };

  for (const value of RRX.VIEWS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = VIEW_LABELS[value] || value;
    view.appendChild(option);
  }

  /** A slider's label: nullable settings read "default" when unset. */
  function sliderLabel(key, value) {
    if (value === null) return 'default';
    return key === 'reader.maxWidthPx' ? `${value}px` : String(value);
  }

  function render({ settings, hidden }) {
    for (const box of boxes) box.checked = !!settings[box.dataset.setting];
    view.value = settings['list.view'];
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
    boxes.find((b) => b.dataset.setting === 'list.hoverExpand').disabled =
      settings['list.expandAll'];
    boxes.find((b) => b.dataset.setting === 'hide.showHidden').disabled = off('hide.enabled');
    boxes.find((b) => b.dataset.setting === 'reader.justify').disabled = off('reader.enabled');
    for (const slider of sliders) slider.disabled = off('reader.enabled');
  }

  const refresh = async () => render(await RRX.store.load());

  for (const box of boxes) {
    box.addEventListener('change', async () => {
      await RRX.store.saveSettings({ [box.dataset.setting]: box.checked });
      refresh();
    });
  }

  view.addEventListener('change', async () => {
    await RRX.store.saveSettings({ 'list.view': view.value });
    refresh();
  });

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

  refresh();
})();
