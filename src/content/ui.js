'use strict';

/**
 * DOM primitives for the controls we inject: a tiny element factory, an inline
 * SVG icon set, and the toolbar builder.
 *
 * Everything is built with createElement/createElementNS rather than innerHTML,
 * so no fiction title or other page string is ever parsed as markup.
 */
(function (root) {
  const RRX = root.RRX;
  if (!RRX || RRX.ui) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Icon path data, 24x24 viewBox, stroked (never filled). */
  const ICONS = {
    expandAll: ['M5 5.5 12 12l7-6.5', 'M5 12.5 12 19l7-6.5'],
    hoverExpand: ['M4 3.5 10.5 20l2.4-6.6L19.5 11z', 'M13.4 13.6 19 19.6'],
    showHidden: [
      'M2 12s3.6-6.6 10-6.6S22 12 22 12s-3.6 6.6-10 6.6S2 12 2 12z',
      'M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z',
    ],
    manage: ['M4 7h16', 'M4 12h16', 'M4 17h16', 'M9 5v4', 'M15 10v4', 'M7 15v4'],
    filters: ['M3 5h18', 'M6.5 12h11', 'M10 19h4'],
    loadMore: ['M12 4v12', 'M7 12l5 5 5-5', 'M4 20h16'],
    view: ['M4 5h7v6H4z', 'M13 5h7v6h-7z', 'M4 13h7v6H4z', 'M13 13h7v6h-7z'],
    minus: ['M6 12h12'],
    plus: ['M12 6v12', 'M6 12h12'],
  };

  /**
   * @param {string} tag
   * @param {object} [props] `class`, `text`, `title`, `aria-*`, `data-*`, on* handlers
   * @param {Array<Node>} [children]
   */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children || []) if (child) node.appendChild(child);
    return node;
  }

  /** @param {keyof ICONS} name */
  function icon(name, className) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', className || 'rrx-btn__icon');
    for (const d of ICONS[name] || []) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  /**
   * A toolbar toggle. `aria-pressed` is the single source of truth for its
   * on/off styling, so no extra state class is needed.
   */
  function toggleButton({ id, label, title, iconName, pressed, badge, onClick }) {
    const children = [icon(iconName), el('span', { text: label })];
    if (badge !== undefined) children.push(el('span', { class: 'rrx-badge', text: String(badge) }));
    return el(
      'button',
      {
        type: 'button',
        class: 'rrx-btn',
        'data-rrx-toggle': id,
        'aria-pressed': pressed ? 'true' : 'false',
        title: title || label,
        onClick,
      },
      children
    );
  }

  function actionButton({ id, label, title, iconName, onClick }) {
    return el(
      'button',
      { type: 'button', class: 'rrx-btn', 'data-rrx-action': id, title: title || label, onClick },
      [icon(iconName), el('span', { text: label })]
    );
  }

  /** Small circular control overlaid on a fiction card. */
  function cardButton({ label, iconName, modifier, onClick }) {
    return el(
      'button',
      {
        type: 'button',
        class: `rrx-ui rrx-card-btn${modifier ? ` ${modifier}` : ''}`,
        'aria-label': label,
        title: label,
        onClick,
      },
      [icon(iconName, 'rrx-card-btn__icon')]
    );
  }

  /**
   * Transient confirmation with an undo affordance. Hiding a fiction is easy to
   * mis-click and the card vanishes instantly, so an inline undo is the only
   * cheap way back - everything else means opening the manager.
   *
   * One toast at a time: a second call replaces the first.
   */
  let toastTimer = null;
  function toast(message, actionLabel, onAction, timeoutMs = 6000) {
    const existing = document.getElementById('rrx-toast');
    if (existing) existing.remove();
    if (toastTimer) clearTimeout(toastTimer);

    const dismiss = () => {
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = null;
      node.remove();
    };

    const children = [el('span', { class: 'rrx-toast__text', text: message })];
    if (actionLabel && onAction) {
      children.push(
        el('button', {
          type: 'button',
          class: 'rrx-toast__action',
          text: actionLabel,
          onClick: () => {
            dismiss();
            onAction();
          },
        })
      );
    }
    children.push(
      el('button', {
        type: 'button',
        class: 'rrx-toast__close',
        'aria-label': 'Dismiss',
        text: '×',
        onClick: dismiss,
      })
    );

    const node = el('div', { id: 'rrx-toast', class: 'rrx-ui rrx-toast', role: 'status' }, children);
    document.body.appendChild(node);
    toastTimer = setTimeout(dismiss, timeoutMs);
    return node;
  }

  RRX.ui = { el, icon, toggleButton, actionButton, cardButton, toast, ICONS };
})(globalThis);
