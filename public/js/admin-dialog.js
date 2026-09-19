'use strict';

window.AdminDialog = (function () {
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
      const overlay = el('div', { className: 'admin-dialog-overlay' });
      const form = el('form', { className: 'admin-dialog-card' });
      const heading = el('h2', { className: 'admin-dialog-title' }, title);
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

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

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

  return { ask };
})();
