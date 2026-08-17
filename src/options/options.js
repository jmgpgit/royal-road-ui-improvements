'use strict';

/** Options page: schema-built settings sections, the two fiction managers, and
 *  JSON backup. Writes go to the browser.storage.local every Royal Road tab
 *  reads, so open tabs pick changes up through storage.onChanged, no reload. */
(function () {
  const RRX = globalThis.RRX;
  const { SCHEMA, COPY, SECTIONS } = RRX;
  const $ = (id) => document.getElementById(id);

  let state = {
    settings: RRX.normalizeSettings(null),
    hidden: {},
    dropped: {},
    chapters: {},
    stats: {},
  };

  /** Hand-written markup rather than generated rows, so render moves them into
   *  the list settings box. They live here until then, so the listeners below
   *  find them. */
  const managerSections = [$('hidden-section'), $('dropped-section')];

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
    // Re-read rather than assumed: a settings write can delete a whole map -
    // switching the fiction readings off does - and a stale copy here would let
    // Export write out what was just deleted.
    state.stats = await RRX.store.loadStats();
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
      // Empty means "no constraint", which is not 0, so nullable fields stay blank.
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
    // Pattern lists get a textarea; everything else is a one-liner.
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

  /** Controls greyed out while their master switch is off. */
  const DEPENDENCIES = {
    'list.hoverExpand': () => !state.settings['list.expandAll'],
    'list.hoverDelayMs': () => state.settings['list.hoverExpand'] && !state.settings['list.expandAll'],
    'hide.showHidden': () => state.settings['hide.enabled'],
    // Deliberately absent: `drop.enabled` off keeps the list, the same way
    // `hide.enabled` does, so its manager stays usable.
    'reader.lineHeight': () => state.settings['reader.enabled'],
    'reader.justify': () => state.settings['reader.enabled'],
    'reader.hyphens': () => state.settings['reader.enabled'] && state.settings['reader.justify'],
    'reader.textColor': () => state.settings['reader.enabled'],
    'reader.fontFamily': () => state.settings['reader.enabled'],
    'reader.maxWidthPx': () => state.settings['reader.enabled'],
    'comments.foldPatterns': () => state.settings['comments.patternAction'] !== 'keep',
    'recap.paragraphs': () => state.settings['recap.mode'] !== 'off',
    // Only the estimate uses it; a word count does not.
    'chapter.wpm': () =>
      state.settings['chapter.wordCount'] === 'time' || state.settings['chapter.wordCount'] === 'both',
    'comments.seenDays': () => state.settings['comments.seen'] !== 'off',
    'comments.separators': () => state.settings['comments.threading'],
    'comments.dividerOpacity': () =>
      state.settings['comments.threading'] && state.settings['comments.separators'],
    'comments.collapsible': () => state.settings['comments.threading'],
    'comments.threadColor': () => state.settings['comments.threading'],
  };

  function renderSections() {
    const host = $('sections');
    // Lift them clear before the wipe, or the re-render destroys them.
    for (const section of managerSections) section.remove();
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
          ...(section.id === 'lists' ? managerSections : []),
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

  // --- the hidden and dropped managers ---------------------------------------

  function formatDate(ms) {
    if (!ms) return 'date unknown';
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /** The two lists are the same list with different words, so they share a
   *  renderer rather than drifting apart a line at a time. */
  const MANAGERS = {
    hidden: {
      stamp: 'hiddenAt',
      /** What the date line says, and the per-row button. */
      past: 'Hidden',
      undo: 'Unhide',
      empty: 'Nothing hidden yet. Use the − button on any fiction card on Royal Road.',
      noMatch: (needle) => `No hidden fiction matches “${needle}”.`,
      ids: () => RRX.hiddenIds(state.hidden),
      records: () => state.hidden,
      remove: (id) => RRX.store.unhide(id),
      adopt: (next) => {
        state.hidden = next;
      },
    },
    dropped: {
      stamp: 'droppedAt',
      past: 'Dropped',
      undo: 'Restore',
      empty:
        'Nothing dropped yet. Turn on “Mark fictions you tried and dropped” above, then use the ' +
        'bookmark button on any fiction card on Royal Road.',
      noMatch: (needle) => `No dropped fiction matches “${needle}”.`,
      ids: () => RRX.droppedIds(state.dropped),
      records: () => state.dropped,
      remove: (id) => RRX.store.undrop(id),
      adopt: (next) => {
        state.dropped = next;
      },
    },
  };

  /** One search box each, kept out of the manager definitions because it is
   *  view state rather than what the list is. */
  const search = { hidden: '', dropped: '' };

  function renderManager(kind) {
    const manager = MANAGERS[kind];
    const list = $(`${kind}-list`);
    const empty = $(`${kind}-empty`);
    const records = manager.records();
    const ids = manager.ids();
    $(`${kind}-count`).textContent = String(ids.length);

    const needle = search[kind].trim().toLowerCase();
    const visible = ids
      .map((id) => ({ id, ...records[id] }))
      // Most recent first - that is what you are most likely undoing.
      .sort((a, b) => b[manager.stamp] - a[manager.stamp])
      .filter((rec) => !needle || rec.title.toLowerCase().includes(needle));

    empty.hidden = ids.length > 0 && visible.length > 0;
    if (!ids.length) empty.textContent = manager.empty;
    else if (!visible.length) empty.textContent = manager.noMatch(search[kind]);

    list.textContent = '';
    for (const rec of visible) {
      const cover = el('img', { class: 'fic-item__cover', alt: '', loading: 'lazy' });
      if (rec.cover) cover.src = rec.cover;

      list.appendChild(
        el('li', { class: 'fic-item' }, [
          cover,
          el('div', { class: 'fic-item__body' }, [
            el('a', {
              class: 'fic-item__title',
              href: new URL(rec.url, 'https://www.royalroad.com').href,
              target: '_blank',
              rel: 'noreferrer',
              text: rec.title,
            }),
            el('div', {
              class: 'fic-item__meta',
              text: `${manager.past} ${formatDate(rec[manager.stamp])}`,
            }),
          ]),
          el('button', {
            type: 'button',
            class: 'btn btn--small',
            text: manager.undo,
            onClick: async () => {
              manager.adopt(await manager.remove(rec.id));
              renderManager(kind);
            },
          }),
        ])
      );
    }
  }

  function render() {
    renderSections();
    renderManager('hidden');
    renderManager('dropped');
    renderHistorySize();
  }

  // --- backup ----------------------------------------------------------------

  const status = $('backup-status');

  function setStatus(message, kind) {
    status.textContent = message;
    status.className = `status${kind ? ` status--${kind}` : ''}`;
  }

  $('export').addEventListener('click', () => {
    const backup = RRX.buildBackup(state, Date.now());
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    );
    const link = el('a', {
      href: url,
      download: `royal-road-ui-improvements-${new Date().toISOString().slice(0, 10)}.json`,
    });
    link.click();
    URL.revokeObjectURL(url);
    const hidden = RRX.hiddenIds(state.hidden).length;
    const dropped = RRX.droppedIds(state.dropped).length;
    setStatus(`Exported your settings, ${hidden} hidden and ${dropped} dropped fictions.`, 'ok');
  });

  $('import').addEventListener('click', () => $('import-file').click());

  $('import-file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const parsed = RRX.parseBackup(await file.text());
      const incoming = RRX.hiddenIds(parsed.hidden).length;
      const incomingDropped = RRX.droppedIds(parsed.dropped).length;
      const current = RRX.hiddenIds(state.hidden).length;
      const dropped = RRX.droppedIds(state.dropped).length;
      // Everything the import replaces has to be named, or the prompt is
      // agreeing to less than it does.
      const read = Object.keys(state.chapters || {}).length;
      const watched = Object.keys(state.stats || {}).length;
      const also = [
        dropped ? `${dropped} dropped fiction${dropped === 1 ? '' : 's'}` : '',
        read ? `where you had got to in ${read} chapter${read === 1 ? '' : 's'}` : '',
        watched ? `the statistics you have seen for ${watched} fiction${watched === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      if (
        (current || dropped || read || watched) &&
        !confirm(
          `Replace your current settings, ${current} hidden fiction${current === 1 ? '' : 's'}` +
            `${also.length ? `, ${also.join(' and ')}` : ''} with what is in this file?`
        )
      ) {
        setStatus('Import cancelled.');
        return;
      }
      state = await RRX.store.replaceAll(parsed);
      render();
      setStatus(`Imported ${incoming} hidden and ${incomingDropped} dropped fictions.`, 'ok');
    } catch (err) {
      setStatus(err.message || 'Could not read that file.', 'error');
    }
  });

  // Not the fiction statistics: reset returns that setting to its default, which
  // is off, and off deletes them. Promising otherwise would be a lie in a
  // confirm dialog.
  const KEPT = 'Your hidden fictions, dropped fictions and reading progress are kept.';

  $('reset').addEventListener('click', async () => {
    if (!confirm(`Reset every setting to its default? ${KEPT}`)) return;
    state.settings = await RRX.store.resetSettings();
    state.stats = {}; // reset turns the readings off, which clears them
    render();
    setStatus(`Settings reset to defaults. ${KEPT}`, 'ok');
  });

  /** What the reader has accumulated by reading, as opposed to by choosing. The
   *  hidden and dropped lists have their own managers; this is the half nobody
   *  could see, let alone clear, without uninstalling. */
  function renderHistorySize() {
    const chapters = Object.keys(state.chapters || {}).length;
    const fictions = Object.keys(state.stats || {}).length;
    const parts = [];
    if (chapters) parts.push(`${chapters} chapter${chapters === 1 ? '' : 's'}`);
    if (fictions) parts.push(`${fictions} fiction${fictions === 1 ? '' : 's'}`);

    $('history-size').textContent = parts.length
      ? `Reading history: ${parts.join(' and ')}. Kept on this device, and aged out on its own.`
      : 'No reading history stored.';
    $('forget-history').disabled = !parts.length;
  }

  $('forget-history').addEventListener('click', async () => {
    if (
      !confirm(
        'Forget where you got to in every chapter, which comments you had seen, and the ' +
          'fiction statistics? Your settings, hidden fictions and dropped fictions are kept. ' +
          'This cannot be undone.'
      )
    ) {
      return;
    }
    state.chapters = await RRX.store.forgetChapters();
    state.stats = await RRX.store.forgetStats();
    renderHistorySize();
    setStatus('Reading history forgotten.', 'ok');
  });

  $('unhide-all').addEventListener('click', async () => {
    const count = RRX.hiddenIds(state.hidden).length;
    if (!count) return;
    if (!confirm(`Unhide all ${count} fiction${count === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    state.hidden = await RRX.store.unhideAll();
    renderManager('hidden');
  });

  $('undrop-all').addEventListener('click', async () => {
    const count = RRX.droppedIds(state.dropped).length;
    if (!count) return;
    if (!confirm(`Clear all ${count} dropped fiction${count === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    state.dropped = await RRX.store.undropAll();
    renderManager('dropped');
  });

  for (const kind of Object.keys(MANAGERS)) {
    $(`${kind}-search`).addEventListener('input', (event) => {
      search[kind] = event.target.value;
      renderManager(kind);
    });
  }

  // --- boot ------------------------------------------------------------------

  // `onChange` carries settings, hidden and dropped only - reading progress and
  // fiction statistics are left out of its guard on purpose - so the spread
  // keeps the two we already hold rather than overwriting them with undefined.
  RRX.store.onChange((next) => {
    state = { ...state, ...next };
    render();
  });

  Promise.all([RRX.store.load(), RRX.store.loadChapters(), RRX.store.loadStats()]).then(
    ([next, chapters, stats]) => {
      state = { ...next, chapters, stats };
      render();
    }
  );
})();
