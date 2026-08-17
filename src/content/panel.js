'use strict';

/**
 * The filter panel that drops out of the toolbar. Grouped, not one flat run:
 * fourteen filters in a flat list is a wall.
 *
 * Apply commits; otherwise every digit typed into a number box would re-filter
 * the page and write to storage. Chips commit to the draft at once - there is
 * nothing to finish typing.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX || RRX.panel) return;
  const { ui, SCHEMA } = RRX;
  const { el } = ui;

  const PANEL_ID = 'rrx-filter-panel';

  const DATE_PRESETS = [
    ['Any', null],
    ['Week', 7],
    ['Month', 30],
    ['3 months', 90],
    ['Year', 365],
  ];

  /** Draft values, held until Apply. Keyed the same as settings. */
  let draft = {};

  /** Bumped on every open. The toolbar gets rebuilt underneath us, so a stale
   *  tag-load callback would re-parent the panel into the detached toolbar it
   *  captured and the panel would silently disappear. */
  let openToken = 0;

  // --- fields ----------------------------------------------------------------

  /** A bounded number box. min/max come from the schema, so the control cannot
   *  offer a value the filter would reject - rating stops at 0 to 5. */
  function numberInput(key, step, placeholder) {
    const spec = SCHEMA[key] || {};
    const input = el('input', {
      type: 'number',
      class: 'rrx-field__num',
      step,
      min: spec.min,
      max: spec.max,
      placeholder: placeholder || '-',
      'data-rrx-key': key,
      onInput: (e) => {
        const raw = e.target.value.trim();
        draft[key] = raw === '' ? null : Number(raw);
      },
    });
    input.value = draft[key] === null || draft[key] === undefined ? '' : String(draft[key]);
    return input;
  }

  function rangeRow([label, minKey, maxKey, step]) {
    return el('div', { class: 'rrx-field' }, [
      el('span', { class: 'rrx-field__label', text: label }),
      numberInput(minKey, step, 'min'),
      el('span', { class: 'rrx-field__dash', text: 'to' }),
      numberInput(maxKey, step, 'max'),
    ]);
  }

  /** A wrapping row of toggle chips backed by one list-valued setting. */
  function chipRow(label, key, values, labelFor) {
    return el('div', { class: 'rrx-field rrx-field--wrap' }, [
      el('span', { class: 'rrx-field__label', text: label }),
      el(
        'div',
        { class: 'rrx-chips' },
        values.map((value) =>
          el('button', {
            type: 'button',
            class: 'rrx-chip',
            'aria-pressed': draft[key].includes(value) ? 'true' : 'false',
            text: labelFor ? labelFor(value) : value,
            onClick: (e) => {
              const on = !draft[key].includes(value);
              draft[key] = on ? [...draft[key], value] : draft[key].filter((v) => v !== value);
              e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
            },
          })
        )
      ),
    ]);
  }

  /**
   * Tag picker: a combobox that turns each pick into a chip. Not a native
   * `<datalist>` - its dropdown will not reopen after a pick without retyping,
   * so this one keeps its own list open between picks.
   *
   * You pick by label ("Romance Subplot"); the filter stores the slug
   * (`romance`). Those differ often enough that typing slugs was a real trap.
   */
  /** Both tag rows report here: neither can see the other's chips, and the
   *  contradiction is only visible from outside both. */
  let notifyTags = () => {};

  function tagRow(label, key) {
    const chips = el('div', { class: 'rrx-chips' });
    const menu = el('div', { class: 'rrx-combo__menu', hidden: true });

    const renderChips = () => {
      chips.textContent = '';
      for (const slug of draft[key]) {
        chips.appendChild(
          el('button', {
            type: 'button',
            class: 'rrx-chip rrx-chip--on',
            title: `Remove ${RRX.tags.labelFor(slug)}`,
            text: `${RRX.tags.labelFor(slug)} ×`,
            onClick: () => {
              draft[key] = draft[key].filter((s) => s !== slug);
              renderChips();
              notifyTags();
            },
          })
        );
      }
    };

    const add = (slug) => {
      if (!slug) return;
      if (!draft[key].includes(slug)) draft[key] = [...draft[key], slug];
      renderChips();
      notifyTags();
    };

    const input = el('input', {
      type: 'text',
      class: 'rrx-field__text',
      role: 'combobox',
      autocomplete: 'off',
      'aria-expanded': 'false',
      placeholder: RRX.tags.all().length ? 'Type to find a tag…' : 'Tag slug…',
    });

    const closeMenu = () => {
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };

    const openMenu = () => {
      const matches = RRX.tags.search(input.value, 8).filter((t) => !draft[key].includes(t.slug));
      menu.textContent = '';
      if (!matches.length) return closeMenu();
      for (const tag of matches) {
        menu.appendChild(
          el('button', {
            type: 'button',
            class: 'rrx-combo__item',
            text: tag.label,
            // mousedown, not click: the input's blur would close the menu first.
            onMousedown: (e) => {
              e.preventDefault();
              add(tag.slug);
              input.value = '';
              openMenu(); // stay open, ready for the next one
            },
          })
        );
      }
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };

    input.addEventListener('input', openMenu);
    input.addEventListener('focus', openMenu);
    input.addEventListener('blur', () => setTimeout(closeMenu, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        e.stopPropagation(); // close the menu, not the whole panel
        closeMenu();
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation(); // Enter here means "add this tag", not "apply"
      const typed = input.value.trim();
      // An empty field used to add whatever sorted first: `search('')` answers
      // with the whole catalogue, and the first of it is not a choice anyone made.
      if (!typed) return;
      const [best] = RRX.tags.search(typed, 1);
      // Typed text falls back to a slug, so anyone who knows one can skip the picker.
      add(best ? best.slug : typed.toLowerCase().replace(/\s+/g, '_'));
      input.value = '';
      openMenu();
    });

    renderChips();

    return el('div', { class: 'rrx-field rrx-field--wrap' }, [
      el('span', { class: 'rrx-field__label', text: label }),
      el('div', { class: 'rrx-field__stack' }, [
        el('div', { class: 'rrx-combo' }, [input, menu]),
        chips,
      ]),
    ]);
  }

  function dateRow(label, key) {
    return el('div', { class: 'rrx-field rrx-field--wrap' }, [
      el('span', { class: 'rrx-field__label', text: label }),
      el(
        'div',
        { class: 'rrx-chips' },
        DATE_PRESETS.map(([text, days]) =>
          el('button', {
            type: 'button',
            class: 'rrx-chip',
            'aria-pressed': draft[key] === days ? 'true' : 'false',
            text,
            onClick: (e) => {
              draft[key] = days;
              for (const sib of e.currentTarget.parentElement.children) {
                sib.setAttribute('aria-pressed', sib === e.currentTarget ? 'true' : 'false');
              }
            },
          })
        )
      ),
    ]);
  }

  const group = (title, rows) =>
    el('section', { class: 'rrx-group' }, [
      el('h3', { class: 'rrx-group__title', text: title }),
      ...rows,
    ]);

  // --- state -----------------------------------------------------------------

  function resetDraft(ctx) {
    draft = {};
    for (const key of RRX.group('filters')) {
      const value = ctx.settings[key];
      draft[key] = Array.isArray(value) ? [...value] : value;
    }
  }

  function close() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
  }

  const isOpen = () => !!document.getElementById(PANEL_ID);

  /**
   * @param {Element} anchor the toolbar the panel hangs under
   * @param {object} ctx main.js's shared context
   * @param {{keepDraft?: boolean}} [options]
   */
  function open(anchor, ctx, options = {}) {
    close();
    const token = (openToken += 1);
    // A toolbar rebuild re-opens the panel; keeping the draft saves half-entered values.
    if (!options.keepDraft) resetDraft(ctx);

    const apply = async () => {
      close();
      await ctx.setSettings({ ...draft, 'filters.enabled': true });
    };

    const clear = async () => {
      close();
      const cleared = {};
      for (const key of RRX.group('filters')) {
        if (key === 'filters.enabled') continue;
        cleared[key] = Array.isArray(ctx.settings[key]) ? [] : null;
      }
      await ctx.setSettings(cleared);
    };

    // A tag in both lists can never match anything, and the empty list that
    // results looks exactly like a filter that is merely strict.
    const tagWarning = el('div', { class: 'rrx-panel__warn', role: 'status', hidden: true });

    notifyTags = () => {
      const both = draft['filters.tagsAll'].filter((slug) =>
        draft['filters.tagsNone'].includes(slug)
      );
      tagWarning.hidden = !both.length;
      if (!both.length) return;
      const names = both.map((slug) => RRX.tags.labelFor(slug)).join(', ');
      tagWarning.textContent =
        both.length > 1
          ? `${names} are in both lists, so nothing can match.`
          : `${names} is in both lists, so nothing can match.`;
    };

    const body = el('div', { class: 'rrx-panel__body' }, [
      group('Score and size', [
        rangeRow(['Rating', 'filters.minRating', 'filters.maxRating', '0.1']),
        rangeRow(['Followers', 'filters.minFollowers', 'filters.maxFollowers', '100']),
        rangeRow(['Views', 'filters.minViews', 'filters.maxViews', '1000']),
        rangeRow(['Pages', 'filters.minPages', 'filters.maxPages', '10']),
        rangeRow(['Chapters', 'filters.minChapters', 'filters.maxChapters', '10']),
      ]),
      group('Tags', [
        tagRow('Must have', 'filters.tagsAll'),
        tagRow('Must not', 'filters.tagsNone'),
        tagWarning,
      ]),
      group('Kind', [
        chipRow('Status', 'filters.status', RRX.STATUSES, (v) => v[0] + v.slice(1).toLowerCase()),
        chipRow('Type', 'filters.type', RRX.TYPES),
      ]),
      group('Activity', [
        dateRow('Updated within', 'filters.updatedWithinDays'),
        dateRow('Quiet for', 'filters.staleForDays'),
        chipRow('Hide mine', 'filters.hideMine', RRX.MINE, (v) =>
          ({ follow: 'Following', favorite: 'Favourited', ril: 'Read Later', dropped: 'Dropped' })[v]
        ),
      ]),
    ]);

    // Saved filters can already contradict each other before anything is typed.
    notifyTags();

    const footer = el('div', { class: 'rrx-panel__footer' }, [
      el('button', { type: 'button', class: 'rrx-btn', text: 'Clear all', onClick: clear }),
      el('span', { class: 'rrx-toolbar__spacer' }),
      el('button', { type: 'button', class: 'rrx-btn', text: 'Cancel', onClick: close }),
      el('button', {
        type: 'button',
        class: 'rrx-btn rrx-btn--primary',
        text: 'Apply',
        onClick: apply,
      }),
    ]);

    const panel = el(
      'div',
      { id: PANEL_ID, class: 'rrx-ui rrx-panel', role: 'dialog', 'aria-label': 'Filters' },
      [body, footer]
    );

    // Enter applies, Escape cancels. The tag inputs stop Enter before it gets here.
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        apply();
      }
    });

    anchor.appendChild(panel);
    const first = panel.querySelector('input');
    if (first) first.focus();

    // If the vocabulary lands after opening, re-render so the pickers gain their
    // dropdown rather than staying free-text.
    if (!RRX.tags.all().length) {
      RRX.tags.load().then((tags) => {
        // Newest open only, and onto the live toolbar: `anchor` may be stale.
        if (token !== openToken || !tags.length || !isOpen()) return;
        const live = document.getElementById(PANEL_ID).parentElement;
        open(live, ctx, { keepDraft: true });
      });
    }
  }

  RRX.panel = { open, close, isOpen, PANEL_ID };
})(globalThis);
