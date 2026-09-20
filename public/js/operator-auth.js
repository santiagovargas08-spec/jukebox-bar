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
      const previousFocus = document.activeElement;
      const headingId = 'operator-login-title-' + Date.now();
      const overlay = createElement('div', { className: 'operator-login-overlay' });
      const card = createElement('form', {
        className: 'operator-login-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': headingId
      });
      const heading = createElement(
        'h2',
        {
          className: 'operator-login-title',
          id: headingId
        },
        titulo
      );
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

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup();
          reject(new Error('Inicio de sesión cancelado.'));
        }
      };

      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();

        if (
          previousFocus &&
          typeof previousFocus.focus === 'function' &&
          document.contains(previousFocus)
        ) {
          setTimeout(() => previousFocus.focus(), 0);
        }
      };

      document.addEventListener('keydown', onKeyDown);

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

  function conectarSocket(socket, auth = {}) {
    if (socket.connected) {
      return Promise.resolve();
    }

    // La autenticación viaja únicamente en la cookie HttpOnly.
    socket.auth = auth;

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

  async function validarSesion(slug) {
    const response = await fetch(
      `/api/public/bars/${encodeURIComponent(slug)}/operator/session`,
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          'Cache-Control': 'no-store'
        }
      }
    );

    if (!response.ok) return null;

    const result = await response.json().catch(() => null);

    return result?.ok
      ? result.data
      : null;
  }

  async function autenticarConCredenciales(slug, titulo) {
    const credentials = await pedirCredenciales(titulo);

    const response = await fetch(
      `/api/public/bars/${encodeURIComponent(slug)}/operator/login`,
      {
        method: 'POST',
        credentials: 'same-origin',
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

    if (!response.ok || !result.ok || !result.data?.admin) {
      throw new Error(
        result.error ||
        'No se pudo iniciar sesión.'
      );
    }

    return result.data.admin;
  }

  async function iniciarSesionOperador({ slug, socket, titulo }) {
    if (!slug || !socket) {
      throw new Error(
        'No se pudo inicializar la sesión del operador.'
      );
    }

    let admin = await validarSesion(slug);

    if (!admin) {
      admin = await autenticarConCredenciales(
        slug,
        titulo
      );
    }

    try {
      await conectarSocket(socket);
    } catch (error) {
      const unauthorized =
        String(error?.message || '')
          .includes('UNAUTHORIZED_OPERATOR');

      if (!unauthorized) {
        throw error;
      }

      socket.disconnect();

      admin = await autenticarConCredenciales(
        slug,
        titulo
      );

      await conectarSocket(socket);
    }

    return admin;
  }

  async function iniciarPantallaSinCorreo({
    slug,
    accessKey,
    socket
  }) {
    if (!slug || !accessKey || !socket) {
      throw new Error(
        'Abre la URL de pantalla generada por el Master Admin.'
      );
    }

    await conectarSocket(socket, {
      screenSlug: slug,
      screenAccessKey: accessKey
    });
  }

  async function cerrarSesion({ slug, socket } = {}) {
    if (!slug) return;

    try {
      await fetch(
        `/api/public/bars/${encodeURIComponent(slug)}/operator/logout`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Cache-Control': 'no-store'
          }
        }
      );
    } catch (error) {
      console.warn(
        'No se pudo revocar la sesión en el servidor:',
        error
      );
    } finally {
      if (socket?.connected) socket.disconnect();
    }
  }

  return {
    iniciarSesionOperador,
    iniciarPantallaSinCorreo,
    cerrarSesion
  };
})();
