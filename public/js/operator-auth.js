'use strict';

window.OperatorAuth = (function () {
  function createElement(tag, attrs = {}, text = '') {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') el.className = value;
      else if (key === 'type') el.type = value;
      else if (key === 'autocomplete') el.autocomplete = value;
      else el.setAttribute(key, value);
    });
    if (text) el.textContent = text;
    return el;
  }

  function pedirCredenciales(titulo = 'Acceso de operador') {
    return new Promise((resolve, reject) => {
      const overlay = createElement('div', { className: 'operator-login-overlay' });
      const card = createElement('form', { className: 'operator-login-card' });
      const heading = createElement('h2', { className: 'operator-login-title' }, titulo);
      const help = createElement(
        'p',
        { className: 'operator-login-help' },
        'Ingresa las credenciales autorizadas para este bar.'
      );

      const emailLabel = createElement('label', { className: 'operator-login-label' }, 'Correo');
      const email = createElement('input', {
        className: 'operator-login-input',
        type: 'email',
        autocomplete: 'username',
        required: 'required'
      });

      const passwordLabel = createElement('label', { className: 'operator-login-label' }, 'Contraseña');
      const password = createElement('input', {
        className: 'operator-login-input',
        type: 'password',
        autocomplete: 'current-password',
        required: 'required'
      });

      const error = createElement('div', { className: 'operator-login-error', role: 'alert' });
      const actions = createElement('div', { className: 'operator-login-actions' });
      const cancel = createElement('button', { className: 'operator-login-cancel', type: 'button' }, 'Cancelar');
      const submit = createElement('button', { className: 'operator-login-submit', type: 'submit' }, 'Entrar');

      actions.append(cancel, submit);
      emailLabel.appendChild(email);
      passwordLabel.appendChild(password);
      card.append(heading, help, emailLabel, passwordLabel, error, actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const cleanup = () => overlay.remove();

      cancel.addEventListener('click', () => {
        cleanup();
        reject(new Error('Inicio de sesión cancelado.'));
      });

      card.addEventListener('submit', (event) => {
        event.preventDefault();
        const emailValue = email.value.trim();
        const passwordValue = password.value;
        if (!emailValue || !passwordValue) {
          error.textContent = 'Completa correo y contraseña.';
          return;
        }
        cleanup();
        resolve({ email: emailValue, password: passwordValue });
      });

      setTimeout(() => email.focus(), 0);
    });
  }

  function conectarSocket(socket, token) {
    if (socket.connected) {
      return Promise.resolve();
    }

    socket.auth = { operatorToken: token };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('No se pudo conectar con el servidor.'));
      }, 8000);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };

      const onConnect = () => {
        cleanup();
        resolve();
      };

      const onError = (error) => {
        cleanup();
        reject(error || new Error('No se pudo validar la sesión.'));
      };

      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      socket.connect();
    });
  }

  async function iniciarSesionOperador({ slug, socket, titulo }) {
    if (!slug || !socket) {
      throw new Error('No se pudo inicializar la sesión del operador.');
    }

    const storageKey = `jukebox_operator_${slug}`;
    let token = sessionStorage.getItem(storageKey);

    if (token) {
      try {
        await conectarSocket(socket, token);
        return token;
      } catch (error) {
        const unauthorized =
          String(error?.message || '').includes('UNAUTHORIZED_OPERATOR');

        if (!unauthorized) {
          throw error;
        }

        sessionStorage.removeItem(storageKey);
        socket.disconnect();
        token = null;
      }
    }

    if (!token) {
      const credentials = await pedirCredenciales(titulo);
      const response = await fetch(
        `/api/public/bars/${encodeURIComponent(slug)}/operator/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          },
          body: JSON.stringify(credentials)
        }
      );

      const result = await response.json().catch(() => ({
        ok: false,
        error: 'Respuesta inválida del servidor.'
      }));

      if (!response.ok || !result.ok || !result.data?.token) {
        throw new Error(result.error || 'No se pudo iniciar sesión.');
      }

      token = result.data.token;
      sessionStorage.setItem(storageKey, token);
    }

    await conectarSocket(socket, token);
    return token;
  }

  async function cerrarSesion({ slug, socket } = {}) {
    if (!slug) return;

    const storageKey = `jukebox_operator_${slug}`;
    const token = sessionStorage.getItem(storageKey);

    try {
      if (token) {
        await fetch(
          `/api/public/bars/${encodeURIComponent(slug)}/operator/logout`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Cache-Control': 'no-store'
            }
          }
        );
      }
    } catch (error) {
      console.warn('No se pudo revocar la sesión en el servidor:', error);
    } finally {
      sessionStorage.removeItem(storageKey);
      if (socket?.connected) socket.disconnect();
    }
  }

  return {
    iniciarSesionOperador,
    cerrarSesion
  };
})();
