'use strict';

window.BarLoader = (function () {

  function obtenerSlugDesdeURL() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('bar');

    if (!slug) {
      return null;
    }

    return slug.trim().toLowerCase();
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
    document.body.innerHTML = `
      <main class="app-error-screen">
        <div class="app-error-card">
          <div class="app-error-icon" aria-hidden="true">🎵</div>
          <h1 class="app-error-title">${escapeHtml(titulo || 'GENESIS 2.0')}</h1>
          <p class="app-error-message">${escapeHtml(mensaje)}</p>
        </div>
      </main>
    `;
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

  function conectarSocketBar(socket, barId) {
    function seleccionar() {
      socket.emit('seleccionar_bar', { barId });
    }

    if (socket.connected) {
      seleccionar();
    }

    socket.on('connect', seleccionar);
    socket.on('reconnect', () => {
      socket.emit('solicitar_estado', { barId });
    });

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
