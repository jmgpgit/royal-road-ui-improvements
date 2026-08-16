'use strict';

/**
 * Author notes: collapse cross-promotion, keep the actual note.
 *
 * Hide any direct child block of `.author-note` that links to a fiction other
 * than the one being read. Blunt on purpose - a heuristic that occasionally
 * eats a real note is worse. Notes are TinyMCE output, so a shoutout is almost
 * always one top-level block (a table, or a div wrapping a cover image and a
 * blurb) sitting among ordinary paragraphs that have to survive. Nothing leaves
 * the DOM: each hidden block gets a chip that puts it back.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX) return;
  const features = (RRX.features = RRX.features || { list: [] });
  const { SEL, ui } = RRX;

  /** Below this, what is left of a note is not worth showing on its own. */
  const RESIDUAL_TEXT_CHARS = 25;

  const HIDDEN_CLASS = 'rrx-note-hidden';
  const DONE_ATTR = 'data-rrx-notes';

  function currentFictionId() {
    return RRX.fictionIdFromHref(root.location.pathname);
  }

  function isShoutout(block, ownId) {
    for (const a of block.querySelectorAll(`a${SEL.fictionHref}`)) {
      const id = RRX.fictionIdFromHref(a.getAttribute('href') || '');
      if (id && id !== ownId) return true;
    }
    return false;
  }

  /** Swap a block for a chip that restores it. */
  function collapse(block, label) {
    block.classList.add(HIDDEN_CLASS);
    const chip = ui.el('button', {
      type: 'button',
      class: 'rrx-ui rrx-note-chip',
      text: label,
      title: 'Show this again',
      onClick: () => {
        block.classList.remove(HIDDEN_CLASS);
        chip.remove();
      },
    });
    block.parentElement.insertBefore(chip, block);
    return chip;
  }

  /**
   * @param {Element} note the `.author-note` element
   * @param {number|null} ownId the fiction being read
   * @returns {number} how many blocks were collapsed
   */
  function collapseShoutouts(note, ownId) {
    const blocks = [...note.children];
    let collapsed = 0;
    for (const block of blocks) {
      if (!isShoutout(block, ownId)) continue;
      collapse(block, '▸ shoutout hidden: show');
      collapsed += 1;
    }
    return collapsed;
  }

  function residualText(note) {
    return [...note.children]
      .filter((b) => !b.classList.contains(HIDDEN_CLASS))
      .map((b) => b.textContent.trim())
      .join(' ')
      .trim();
  }

  /** Collapse the whole card behind a single chip. */
  function collapseCard(card, label) {
    const inner = card.querySelector(SEL.authorNote) || card;
    if (inner.classList.contains(HIDDEN_CLASS)) return;

    // Per-block chips would be orphaned above a collapsed note.
    for (const chip of card.querySelectorAll('.rrx-note-chip')) chip.remove();

    // Blocks left individually hidden would stay hidden when the card chip
    // restores - which read as "I clicked show and nothing appeared".
    for (const block of inner.querySelectorAll(`.${HIDDEN_CLASS}`)) {
      block.classList.remove(HIDDEN_CLASS);
    }

    collapse(inner, label);
  }

  function process(ctx) {
    const mode = ctx.settings['notes.mode'];
    const ownId = currentFictionId();
    const blocked = new Set(ctx.settings['notes.blockedAuthors']);
    const authorId = document.querySelector(SEL.authorPanel)?.getAttribute('data-author-id') || '';

    for (const card of document.querySelectorAll(SEL.authorNoteCard)) {
      if (card.getAttribute(DONE_ATTR) === mode) continue;
      card.setAttribute(DONE_ATTR, mode);

      const note = card.querySelector(SEL.authorNote);
      // Royal Road sometimes renders an empty note card; a chip over nothing is
      // worse than leaving it.
      if (!note || !note.textContent.trim()) continue;

      // Start from a clean slate so changing the mode mid-session re-decides.
      for (const chip of card.querySelectorAll('.rrx-note-chip')) chip.remove();
      for (const el of card.querySelectorAll(`.${HIDDEN_CLASS}`)) el.classList.remove(HIDDEN_CLASS);
      note.classList.remove(HIDDEN_CLASS);

      if (mode === 'off' && !blocked.has(authorId)) continue;

      if (mode === 'all' || blocked.has(authorId)) {
        collapseCard(card, '▸ author note hidden: show');
        continue;
      }

      // mode === 'shoutouts'
      const collapsed = collapseShoutouts(note, ownId);
      if (!collapsed) continue;

      // Only a shoutout: one chip beats a chip plus an "A note from …" header
      // above nothing.
      if (residualText(note).length < RESIDUAL_TEXT_CHARS) {
        collapseCard(card, '▸ shoutout hidden: show');
      }
    }
  }

  /**
   * Hide the whole About-author section, heading included, on every instance -
   * Royal Road renders the panel more than once on some chapters.
   *
   * Not CSS: the section is identifiable only by containing both the author card
   * and its own heading, and CSS cannot climb. The climb matches that specific
   * heading - the card carries the author's name in an `<h3>` of its own, so
   * stopping at the first heading found only the card and left the "About
   * author" title above a gap.
   */
  function hideAuthorPanel(on) {
    for (const anchor of document.querySelectorAll(SEL.authorPanel)) {
      let section = anchor;
      let target = anchor;
      for (let i = 0; i < 8 && section.parentElement; i += 1) {
        section = section.parentElement;
        const headings = [...section.querySelectorAll('h1, h2, h3, h4')];
        if (headings.some((h) => h.textContent.includes(SEL.authorPanelHeading))) {
          target = section;
          break;
        }
      }
      target.classList.toggle(HIDDEN_CLASS, on);
    }
  }


  /** Points at this extension's settings from Royal Road's own Reading
   *  Preferences dialog, where a reader goes looking for these controls. */
  function addSettingsLink() {
    const dialog = document.querySelector(SEL.readingPrefsDialog);
    if (!dialog || dialog.querySelector('.rrx-prefs-link')) return;
    dialog.appendChild(
      ui.el('div', { class: 'rrx-ui rrx-prefs-link' }, [
        ui.el('button', {
          type: 'button',
          class: 'rrx-btn',
          text: 'More settings (RR UI Improvements)…',
          title: 'Line height, justification, text colour, font and reading width',
          onClick: () =>
            Promise.resolve(RRX.ext.runtime.sendMessage({ type: 'rrx:open-options' })).catch(
              () => {}
            ),
        }),
      ])
    );
  }

  features.list.push({
    id: 'authorNotes',
    pages: ['chapter'],
    onPage: (ctx) => {
      process(ctx);
      hideAuthorPanel(!!ctx.settings['notes.hideAuthorPanel']);
      addSettingsLink();
    },
  });

  RRX.authorNotes = {
    process,
    collapseShoutouts,
    isShoutout,
    hideAuthorPanel,
    addSettingsLink,
    HIDDEN_CLASS,
  };
})(globalThis);
