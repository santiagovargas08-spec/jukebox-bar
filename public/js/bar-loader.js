'use strict';

window.BarLoader = (function () {

  function obtenerSlugDesdeURL() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('bar');

    if (!raw) {
      return null;
    }

    const slug = raw.trim().toLowerCase();

    if (
      slug.length === 0 ||
      slug.length > 80 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)
    ) {
      return null;
    }

    return slug;
  }

  function escapeHtml(str) {
    if (window.DomSafe) {
      return window.DomSafe.escapeHtml(str);
    }

    if (!str) {
      return '';
    }

    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function mostrarErrorPantalla(mensaje, titulo) {
    const main = document.createElement('main');
    main.className = 'app-error-screen';

    const card = document.createElement('div');
    card.className = 'app-error-card';

    const icon = document.createElement('div');
    icon.className = 'app-error-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🎵';

    const heading = document.createElement('h1');
    heading.className = 'app-error-title';
    heading.textContent =
      titulo || 'GENESIS 2.0';

    const message = document.createElement('p');
    message.className = 'app-error-message';
    message.textContent =
      mensaje || 'No fue posible cargar el bar.';

    card.append(icon, heading, message);
    main.appendChild(card);

    document.body.replaceChildren(main);
  }

  function mensajeLicenciaInvalida(status) {
    if (status === 'SUSPENDED') {
      return 'La licencia de este bar está suspendida.';
    }

    if (status === 'EXPIRED') {
      return 'La licencia de este bar ha expirado.';
    }

    if (status === 'TRIAL') {
      return 'El período de prueba de este bar ha terminado.';
    }

    return 'Este bar no está disponible actualmente.';
  }

  async function cargarBarPorSlug(slug) {
    const respuesta = await fetch(
      `/api/public/bars/${encodeURIComponent(slug)}`,
      { cache: 'no-store' }
    );

    if (!respuesta.ok) {
      throw new Error('Bar no encontrado.');
    }

    const resultado = await respuesta.json();

    if (!resultado.ok || !resultado.data) {
      throw new Error('Respuesta inválida del servidor.');
    }

    return resultado.data;
  }

  async function verificarLicenciaPorSlug(slug) {
    const respuesta = await fetch(
      `/api/public/bars/${encodeURIComponent(slug)}/license/status`,
      { cache: 'no-store' }
    );

    if (!respuesta.ok) {
      throw new Error('No se pudo comprobar la licencia.');
    }

    const resultado = await respuesta.json();

    if (!resultado.ok || !resultado.data) {
      throw new Error('Respuesta de licencia inválida.');
    }

    return resultado.data;
  }

  async function inicializarBar(options) {
    const slug = obtenerSlugDesdeURL();

    if (!slug) {
      mostrarErrorPantalla(
        options.mensajeSinSlug ||
        'Este enlace no identifica ningún bar. Usa la URL con ?bar=slug-del-bar.',
        options.titulo
      );

      return null;
    }

    try {
      const requiereLicencia =
        options.verificarLicencia !== false;

      const [bar, licencia] = await Promise.all([
        cargarBarPorSlug(slug),
        requiereLicencia
          ? verificarLicenciaPorSlug(slug)
          : Promise.resolve(null)
      ]);

      if (!bar.active) {
        mostrarErrorPantalla(
          'Este bar no está disponible actualmente.',
          options.titulo
        );
        return null;
      }

      if (requiereLicencia) {
        if (!licencia.puedeUsar) {
          mostrarErrorPantalla(
            mensajeLicenciaInvalida(licencia.status),
            options.titulo
          );
          return null;
        }

        bar.license = licencia;
      }

      bar.slug = slug;
      return bar;
    } catch (error) {
      console.error('[BarLoader] Error:', error);

      mostrarErrorPantalla(
        error.message || 'No fue posible cargar el bar.',
        options.titulo
      );

      return null;
    }
  }

  function conectarSocketBar(socket, slug) {
    function seleccionar() {
      socket.emit('seleccionar_bar', { slug });
    }

    if (socket.connected) {
      seleccionar();
    }

    // Socket.IO vuelve a emitir "connect" después de cada reconexión.
    // seleccionar_bar ya responde con el estado actual del bar.
    socket.on('connect', seleccionar);

    socket.on('acceso_bloqueado', ({ mensaje }) => {
      mostrarErrorPantalla(
        mensaje || 'El acceso a este bar no está disponible.',
        'GENESIS 2.0'
      );
    });

    return seleccionar;
  }

  return {
    obtenerSlugDesdeURL,
    cargarBarPorSlug,
    verificarLicenciaPorSlug,
    inicializarBar,
    conectarSocketBar,
    mostrarErrorPantalla,
    escapeHtml
  };
})();

