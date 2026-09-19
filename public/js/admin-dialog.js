'use strict';

window.AdminDialog = (function () {
  let dialogSequence = 0;

  function restoreFocus(node) {
    if (
      node &&
      typeof node.focus === 'function' &&
      document.contains(node)
    ) {
      setTimeout(() => node.focus(), 0);
    }
  }

  function bindEscape(close) {
    const handler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener('keydown', handler);

    return () => {
      document.removeEventListener('keydown', handler);
    };
  }

  function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') node.className = value;
      else if (key === 'type') node.type = value;
      else if (key === 'value') node.value = value ?? '';
      else if (key === 'autocomplete') node.autocomplete = value;
      else node.setAttribute(key, value);
    }

    if (text) node.textContent = text;
    return node;
  }

  function ask(title, fields) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const headingId = `admin-dialog-title-${++dialogSequence}`;
      const overlay = el('div', { className: 'admin-dialog-overlay' });
      const form = el('form', {
        className: 'admin-dialog-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': headingId
      });
      const heading = el(
        'h2',
        {
          className: 'admin-dialog-title',
          id: headingId
        },
        title
      );
      const body = el('div', { className: 'admin-dialog-body' });
      const actions = el('div', { className: 'admin-dialog-actions' });
      const cancel = el('button', { type: 'button', className: 'secondary' }, 'Cancelar');
      const submit = el('button', { type: 'submit' }, 'Guardar');

      const inputs = {};

      for (const field of fields) {
        const label = el('label', { className: 'admin-dialog-label' }, field.label || field.name);
        let input;

        if (field.type === 'select') {
          input = el('select', { className: 'admin-dialog-input' });

          for (const option of field.options || []) {
            const optionValue =
              typeof option === 'string'
                ? option
                : option.value;
            const optionLabel =
              typeof option === 'string'
                ? option
                : option.label;

            const optionNode = el('option', { value: optionValue }, optionLabel);
            if (String(optionValue) === String(field.value ?? '')) {
              optionNode.selected = true;
            }
            input.appendChild(optionNode);
          }
        } else {
          input = el('input', {
            className: 'admin-dialog-input',
            type: field.type || 'text',
            value: field.value ?? '',
            autocomplete: field.autocomplete || 'off'
          });

          if (field.placeholder) input.placeholder = field.placeholder;
          if (field.min !== undefined) input.min = String(field.min);
          if (field.step !== undefined) input.step = String(field.step);
        }

        input.name = field.name;
        input.required = Boolean(field.required);
        inputs[field.name] = input;
        label.appendChild(input);
        body.appendChild(label);
      }

      let unbindEscape = () => {};

      const close = (result) => {
        unbindEscape();
        overlay.remove();
        restoreFocus(previousFocus);
        resolve(result);
      };

      unbindEscape = bindEscape(() => close(null));

      cancel.addEventListener('click', () => close(null));

      form.addEventListener('submit', (event) => {
        event.preventDefault();

        if (!form.reportValidity()) return;

        const values = {};

        for (const [name, input] of Object.entries(inputs)) {
          values[name] = input.value;
        }

        close(values);
      });

      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) close(null);
      });

      actions.append(cancel, submit);
      form.append(heading, body, actions);
      overlay.appendChild(form);
      document.body.appendChild(overlay);

      const firstInput = Object.values(inputs)[0];
      if (firstInput) setTimeout(() => firstInput.focus(), 0);
    });
  }

  function confirmAction(
    title,
    message,
    {
      confirmText = 'Confirmar',
      cancelText = 'Cancelar',
      danger = false
    } = {}
  ) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const headingId = `admin-dialog-title-${++dialogSequence}`;
      const overlay = el('div', {
        className: 'admin-dialog-overlay'
      });
      const card = el('div', {
        className: 'admin-dialog-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': headingId
      });
      const heading = el(
        'h2',
        {
          className: 'admin-dialog-title',
          id: headingId
        },
        title
      );
      const body = el(
        'p',
        { className: 'admin-dialog-message' },
        message
      );
      const actions = el('div', {
        className: 'admin-dialog-actions'
      });
      const cancel = el(
        'button',
        { type: 'button', className: 'secondary' },
        cancelText
      );
      const confirmButton = el(
        'button',
        {
          type: 'button',
          className: danger ? 'danger' : ''
        },
        confirmText
      );

      let unbindEscape = () => {};

      const close = (result) => {
        unbindEscape();
        overlay.remove();
        restoreFocus(previousFocus);
        resolve(result);
      };

      unbindEscape = bindEscape(() => close(false));

      cancel.addEventListener('click', () => close(false));
      confirmButton.addEventListener('click', () => close(true));

      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) close(false);
      });

      actions.append(cancel, confirmButton);
      card.append(heading, body, actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      setTimeout(() => confirmButton.focus(), 0);
    });
  }

  function message(title, message, buttonText = 'Aceptar') {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const headingId = `admin-dialog-title-${++dialogSequence}`;
      const overlay = el('div', {
        className: 'admin-dialog-overlay'
      });
      const card = el('div', {
        className: 'admin-dialog-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': headingId
      });
      const heading = el(
        'h2',
        {
          className: 'admin-dialog-title',
          id: headingId
        },
        title
      );
      const body = el(
        'p',
        { className: 'admin-dialog-message' },
        message
      );
      const actions = el('div', {
        className: 'admin-dialog-actions'
      });
      const button = el(
        'button',
        { type: 'button' },
        buttonText
      );

      let unbindEscape = () => {};

      const close = () => {
        unbindEscape();
        overlay.remove();
        restoreFocus(previousFocus);
        resolve();
      };

      unbindEscape = bindEscape(close);

      button.addEventListener('click', close);
      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) close();
      });

      actions.appendChild(button);
      card.append(heading, body, actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      setTimeout(() => button.focus(), 0);
    });
  }

  return { ask, confirm: confirmAction, message };
})();
