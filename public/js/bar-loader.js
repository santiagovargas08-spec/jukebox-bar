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
      <main style="
        min-height:100vh;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
        background:#0a0a0f;
        color:white;
        font-family:Arial,sans-serif;
        text-align:center;
      ">
        <div style="
          width:100%;
          max-width:420px;
          padding:32px 24px;
          border:1px solid rgba(0,240,255,.35);
          border-radius:18px;
          background:rgba(15,15,25,.95);
          box-shadow:0 0 30px rgba(0,240,255,.12);
        ">
          <div style="font-size:3rem;margin-bottom:18px;">🎵</div>
          <h1 style="margin:0 0 12px;color:#00f0ff;">${escapeHtml(titulo || 'GENESIS 2.0')}</h1>
          <p style="margin:0;line-height:1.6;color:#ccc;">${escapeHtml(mensaje)}</p>
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
      const bar = await cargarBarPorSlug(slug);

      if (!bar.active) {
        mostrarErrorPantalla(
          'Este bar no está disponible actualmente.',
          options.titulo
        );
        return null;
      }

      if (options.verificarLicencia !== false) {
        const licencia = await verificarLicenciaPorSlug(slug);

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
