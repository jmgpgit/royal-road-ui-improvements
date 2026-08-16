'use strict';

/**
 * Options page: the settings sections (built from the schema), the
 * hidden-fiction manager, and JSON backup.
 *
 * Writes go to the same browser.storage.local every Royal Road tab reads, so
 * open tabs pick changes up through storage.onChanged without a reload.
 */
(function () {
  const RRX = globalThis.RRX;
  const { SCHEMA, COPY, SECTIONS } = RRX;
  const $ = (id) => document.getElementById(id);

  let state = { settings: RRX.normalizeSettings(null), hidden: {} };
  let filter = '';

  /**
   * The hidden-fiction manager belongs with the list settings, but it is
   * hand-written markup rather than a generated row, so it is moved into that
   * box on render rather than built there. It stays in the document until then,
   * so the listeners set up further down still find their elements.
   */
  const hiddenSection = $('hidden-section');

  // --- element helpers -------------------------------------------------------

  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children || []) if (child) node.appendChild(child);
    return node;
  }

  const commit = async (key, value) => {
    state.settings = await RRX.store.saveSettings({ [key]: value });
    render();
  };

  // --- one control per schema type ------------------------------------------

  function boolRow(key, copy) {
    const input = el('input', {
      type: 'checkbox',
      id: `opt-${key}`,
      'data-setting': key,
      onChange: (e) => commit(key, e.target.checked),
    });
    input.checked = !!state.settings[key];
    return el('label', { class: 'row', for: `opt-${key}` }, [
      input,
      el('span', { class: 'row__body' }, [
        el('span', { class: 'row__title', text: copy.label }),
        copy.note ? el('span', { class: 'row__note', text: copy.note }) : null,
      ]),
    ]);
  }

  function enumRow(key, copy, spec) {
    const select = el('select', {
      id: `opt-${key}`,
      class: 'input',
      'data-setting': key,
      onChange: (e) => commit(key, e.target.value),
    });
    for (const value of spec.values) {
      const option = el('option', {
        value,
        text: (copy.optionLabels && copy.optionLabels[value]) || value,
      });
      if (state.settings[key] === value) option.selected = true;
      select.appendChild(option);
    }
    return el('div', { class: 'row row--stack' }, [
      el('label', { class: 'row__title', for: `opt-${key}`, text: copy.label }),
      select,
      copy.note ? el('p', { class: 'row__note', text: copy.note }) : null,
    ]);
  }

  function numberRow(key, copy, spec) {
    const value = state.settings[key];
    const input = el('input', {
      type: 'number',
      id: `opt-${key}`,
      class: 'input input--num',
      'data-setting': key,
      min: spec.min,
      max: copy.max !== undefined ? copy.max : spec.max,
      step: copy.step || (spec.type === 'int' ? 1 : 'any'),
      // Nullable settings show empty for "no constraint", which is not the same
      // as 0, so the field is left blank rather than filled with a default.
      placeholder: spec.nullable ? 'default' : '',
      onChange: (e) => {
        const raw = e.target.value.trim();
        commit(key, raw === '' ? null : Number(raw));
      },
    });
    input.value = value === null || value === undefined ? '' : String(value);

    return el('div', { class: 'row row--stack' }, [
      el('label', { class: 'row__title', for: `opt-${key}`, text: copy.label }),
      el('div', { class: 'row__inline' }, [
        input,
        copy.unit ? el('span', { class: 'row__unit', text: copy.unit }) : null,
      ]),
      copy.note ? el('p', { class: 'row__note', text: copy.note }) : null,
    ]);
  }

  function stringRow(key, copy) {
    // A pattern list needs room to breathe; everything else is a one-liner.
    const input = copy.multiline
      ? el('textarea', {
          id: `opt-${key}`,
          class: 'input input--area',
          'data-setting': key,
          rows: copy.rows || 4,
          placeholder: copy.placeholder || '',
          spellcheck: 'false',
          onChange: (e) => commit(key, e.target.value.trim()),
        })
      : el('input', {
          type: 'text',
          id: `opt-${key}`,
          class: 'input',
          'data-setting': key,
          placeholder: copy.placeholder || '',
          onChange: (e) => commit(key, e.target.value.trim()),
        });
    input.value = state.settings[key] || '';
    return el('div', { class: 'row row--stack' }, [
      el('label', { class: 'row__title', for: `opt-${key}`, text: copy.label }),
      input,
      copy.note ? el('p', { class: 'row__note', text: copy.note }) : null,
    ]);
  }

  function rowFor(key) {
    const spec = SCHEMA[key];
    const copy = COPY[key] || { label: key };
    if (!spec) return null;
    if (spec.type === 'bool') return boolRow(key, copy);
    if (spec.type === 'enum') return enumRow(key, copy, spec);
    if (spec.type === 'int' || spec.type === 'number') return numberRow(key, copy, spec);
    if (spec.type === 'string') return stringRow(key, copy);
    return null; // lists are edited in context, not here
  }

  /** Grey out a control whose master switch is off, so the hierarchy is visible. */
  const DEPENDENCIES = {
    'list.hoverExpand': () => !state.settings['list.expandAll'],
    'list.hoverDelayMs': () => state.settings['list.hoverExpand'] && !state.settings['list.expandAll'],
    'hide.showHidden': () => state.settings['hide.enabled'],
    'reader.lineHeight': () => state.settings['reader.enabled'],
    'reader.justify': () => state.settings['reader.enabled'],
    'reader.hyphens': () => state.settings['reader.enabled'] && state.settings['reader.justify'],
    'reader.textColor': () => state.settings['reader.enabled'],
    'reader.fontFamily': () => state.settings['reader.enabled'],
    'reader.maxWidthPx': () => state.settings['reader.enabled'],
    'comments.foldPatterns': () => state.settings['comments.patternAction'] !== 'keep',
    'recap.paragraphs': () => state.settings['recap.mode'] !== 'off',
    'comments.separators': () => state.settings['comments.threading'],
    'comments.dividerOpacity': () =>
      state.settings['comments.threading'] && state.settings['comments.separators'],
    'comments.collapsible': () => state.settings['comments.threading'],
    'comments.threadColor': () => state.settings['comments.threading'],
  };

  function renderSections() {
    const host = $('sections');
    // Lift it clear before the wipe, or re-rendering would destroy it.
    hiddenSection.remove();
    host.textContent = '';
    for (const section of SECTIONS) {
      const groups = section.groups.map((group) =>
        el('div', { class: 'group' }, [
          el('h3', { class: 'group__title', text: group.title }),
          ...group.keys.map(rowFor).filter(Boolean),
        ])
      );
      host.appendChild(
        el('section', { class: 'card', 'aria-labelledby': `h-${section.id}` }, [
          el('h2', { id: `h-${section.id}`, text: section.title }),
          section.blurb ? el('p', { class: 'muted card__blurb', text: section.blurb }) : null,
          ...groups,
          section.id === 'lists' ? hiddenSection : null,
        ])
      );
    }

    for (const [key, isEnabled] of Object.entries(DEPENDENCIES)) {
      const control = document.querySelector(`[data-setting="${key}"]`);
      if (!control) continue;
      const off = !isEnabled();
      control.disabled = off;
      const row = control.closest('.row');
      if (row) row.classList.toggle('row--disabled', off);
    }
  }

  // --- hidden fictions -------------------------------------------------------

  function formatDate(ms) {
    if (!ms) return 'date unknown';
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function renderHidden() {
    const list = $('hidden-list');
    const empty = $('hidden-empty');
    const ids = RRX.hiddenIds(state.hidden);
    $('hidden-count').textContent = String(ids.length);

    const needle = filter.trim().toLowerCase();
    const visible = ids
      .map((id) => ({ id, ...state.hidden[id] }))
      // Most recently hidden first: that is what you are most likely undoing.
      .sort((a, b) => b.hiddenAt - a.hiddenAt)
      .filter((rec) => !needle || rec.title.toLowerCase().includes(needle));

    empty.hidden = ids.length > 0 && visible.length > 0;
    if (!ids.length) {
      empty.textContent = 'Nothing hidden yet. Use the − button on any fiction card on Royal Road.';
    } else if (!visible.length) {
      empty.textContent = `No hidden fiction matches “${filter}”.`;
    }

    list.textContent = '';
    for (const rec of visible) {
      const cover = el('img', { class: 'hidden-item__cover', alt: '', loading: 'lazy' });
      if (rec.cover) cover.src = rec.cover;

      list.appendChild(
        el('li', { class: 'hidden-item' }, [
          cover,
          el('div', { class: 'hidden-item__body' }, [
            el('a', {
              class: 'hidden-item__title',
              href: new URL(rec.url, 'https://www.royalroad.com').href,
              target: '_blank',
              rel: 'noreferrer',
              text: rec.title,
            }),
            el('div', { class: 'hidden-item__meta', text: `Hidden ${formatDate(rec.hiddenAt)}` }),
          ]),
          el('button', {
            type: 'button',
            class: 'btn btn--small',
            text: 'Unhide',
            onClick: async () => {
              state.hidden = await RRX.store.unhide(rec.id);
              renderHidden();
            },
          }),
        ])
      );
    }
  }

  function render() {
    renderSections();
    renderHidden();
  }

  // --- backup ----------------------------------------------------------------

  const status = $('backup-status');

  function setStatus(message, kind) {
    status.textContent = message;
    status.className = `status${kind ? ` status--${kind}` : ''}`;
  }

  $('export').addEventListener('click', () => {
    const backup = RRX.buildBackup(state.settings, state.hidden, Date.now());
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    );
    const link = el('a', {
      href: url,
      download: `royal-road-ui-improvements-${new Date().toISOString().slice(0, 10)}.json`,
    });
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${RRX.hiddenIds(state.hidden).length} hidden fictions.`, 'ok');
  });

  $('import').addEventListener('click', () => $('import-file').click());

  $('import-file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const parsed = RRX.parseBackup(await file.text());
      const incoming = RRX.hiddenIds(parsed.hidden).length;
      const current = RRX.hiddenIds(state.hidden).length;
      if (
        current &&
        !confirm(
          `Replace your current settings and ${current} hidden fiction${current === 1 ? '' : 's'} ` +
            `with the ${incoming} in this file?`
        )
      ) {
        setStatus('Import cancelled.');
        return;
      }
      state = await RRX.store.replaceAll(parsed);
      render();
      setStatus(`Imported ${incoming} hidden fictions.`, 'ok');
    } catch (err) {
      setStatus(err.message || 'Could not read that file.', 'error');
    }
  });

  $('reset').addEventListener('click', async () => {
    if (!confirm('Reset every setting to its default? Your hidden fictions are kept.')) return;
    state = await RRX.store.replaceAll({ settings: {}, hidden: state.hidden });
    render();
    setStatus('Settings reset to defaults. Your hidden fictions are kept.', 'ok');
  });

  $('unhide-all').addEventListener('click', async () => {
    const count = RRX.hiddenIds(state.hidden).length;
    if (!count) return;
    if (!confirm(`Unhide all ${count} fiction${count === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    state.hidden = await RRX.store.unhideAll();
    renderHidden();
  });

  $('hidden-search').addEventListener('input', (event) => {
    filter = event.target.value;
    renderHidden();
  });

  // --- boot ------------------------------------------------------------------

  // Keep this page honest if a Royal Road tab or the popup changes something.
  RRX.store.onChange((next) => {
    state = next;
    render();
  });

  RRX.store.load().then((next) => {
    state = next;
    render();
  });
})();
