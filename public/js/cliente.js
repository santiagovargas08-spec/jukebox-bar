    'use strict';
// Oculta thumbnails rotos sin usar manejadores inline (compatible con CSP estricta).
document.addEventListener('error', (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement && target.matches('.admin-thumb, .queue-thumb, .result-thumb, .live-queue-thumb')) {
    target.style.display = 'none';
  }
}, true);



    // ============================================================
    // REFERENCIAS AL DOM
    // ============================================================

    const inputNombre =
      document.getElementById('input-nombre');

    const inputBuscar =
      document.getElementById('input-buscar');

    const btnBuscar =
      document.getElementById('btn-buscar');

    const loadingState =
      document.getElementById('loading-state');

    const errorState =
      document.getElementById('error-state');

    const errorMessage =
      document.getElementById('error-message');

    const resultsSection =
      document.getElementById('results-section');

    const resultsQuery =
      document.getElementById('results-query');

    const resultsList =
      document.getElementById('results-list');

    const successOverlay =
      document.getElementById('success-overlay');

    const successSongName =
      document.getElementById('success-song-name');

    const btnSuccessClose =
      document.getElementById('btn-success-close');

    const liveQueueSection =
      document.getElementById('live-queue-section');

    const liveQueueList =
      document.getElementById('live-queue-list');


    // ============================================================
    // SOCKET.IO
    // ============================================================

    const socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity
    });


    // ============================================================
    // CACHE DE BÚSQUEDAS
    // ============================================================

    const cacheBusquedas = {};


    // ============================================================
    // MULTI-BAR
    //
    // IMPORTANTE:
    //
    // El cliente NO muestra ningún selector.
    //
    // El QR abre algo como:
    //
    // /cliente.html?bar=bar-demo
    //
    // El slug identifica automáticamente el bar.
    // ============================================================

    let barSeleccionado = null;

    let barActual = null;


    async function cargarBarDesdeQR() {
      const bar = await BarLoader.inicializarBar({
        titulo: 'GENESIS 2.0',
        mensajeSinSlug: 'Este enlace no identifica ningún bar. Escanea nuevamente el código QR del establecimiento.'
      });

      if (!bar) {
        return false;
      }

      barSeleccionado = Number(bar.id);
      barActual = bar;

      console.log('[BAR] Bar identificado correctamente:', {
        id: bar.id,
        slug: bar.slug,
        name: bar.name,
        licenseStatus: bar.license?.status
      });

      return true;
    }

    function seleccionarBarAutomaticamente() {
      if (!barSeleccionado) {
        return;
      }

      socket.emit('seleccionar_bar', { barId: barSeleccionado });
    }

    socket.on('connect', () => {
      if (barSeleccionado) {
        seleccionarBarAutomaticamente();
      }
    });

    socket.on('acceso_bloqueado', ({ mensaje }) => {
      BarLoader.mostrarErrorPantalla(
        mensaje || 'El acceso a este bar no está disponible.',
        'GENESIS 2.0'
      );
    });

    async function inicializarCliente() {
      const barValido = await cargarBarDesdeQR();

      if (!barValido) {
        return;
      }

      restaurarNombreGuardado();

      if (socket.connected) {
        seleccionarBarAutomaticamente();
      }
    }

    inicializarCliente();

    socket.on('estado_inicial', ({ cola }) => {
      actualizarColaEnVivo(cola);
    });

    socket.on('error_bar', ({ mensaje }) => {
      barSeleccionado = null;
      barActual = null;
      BarLoader.mostrarErrorPantalla(
        mensaje || 'No se pudo conectar con este bar.',
        'GENESIS 2.0'
      );
    });


    // ============================================================
    // RECORDAR NOMBRE / MESA
    // ============================================================

    function clientNameStorageKey() {
      const slug =
        barActual?.slug ||
        new URLSearchParams(window.location.search).get('bar') ||
        'default';

      return `jukebox_client_name:${slug}`;
    }


    function safeLocalStorageGet(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }

    function safeLocalStorageSet(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }

    function restaurarNombreGuardado() {
      const nombreGuardado =
        safeLocalStorageGet(
          clientNameStorageKey()
        );

      if (nombreGuardado) {
        inputNombre.value =
          nombreGuardado.slice(0, 30);
      }
    }

    window.addEventListener(
      'DOMContentLoaded',
      restaurarNombreGuardado
    );


    // ============================================================
    // COLA ACTUALIZADA
    // ============================================================

    socket.on(
      'cola_actualizada',
      ({ cola }) => {

        actualizarColaEnVivo(
          cola
        );

      }
    );


    // ============================================================
    // CANCIÓN CONFIRMADA
    // ============================================================

    socket.on(
      'cancion_confirmada',
      ({ titulo }) => {

        mostrarExito(
          titulo
        );

      }
    );


    // ============================================================
    // ERROR CANCIÓN
    // ============================================================

    socket.on(
      'error_cancion',
      ({ mensaje }) => {

        mostrarError(
          mensaje
        );

      }
    );


    // ============================================================
    // RESULTADOS DE BÚSQUEDA
    // ============================================================

    socket.on(
      'resultados_busqueda',
      ({ items, query }) => {

        const clave =
          String(query || '')
            .toLowerCase();


        cacheBusquedas[clave] =
          items;


        mostrarLoading(
          false
        );


        renderizarResultados(
          items,
          query
        );

      }
    );


    // ============================================================
    // ERROR DE BÚSQUEDA
    // ============================================================

    socket.on(
      'error_busqueda',
      ({ mensaje }) => {

        mostrarLoading(
          false
        );


        mostrarError(
          mensaje
        );

      }
    );


    // ============================================================
    // BUSCAR VIDEOS
    // ============================================================

    function buscarVideos(query) {

      query =
        String(query || '')
          .trim();


      if (!query) {

        ocultarResultados();

        return;
      }


      const queryLower =
        query.toLowerCase();


      // ----------------------------------------------------------
      // CACHE
      // ----------------------------------------------------------

      if (
        cacheBusquedas[queryLower]
      ) {

        console.log(
          '[BUSQUEDA] Resultado desde cache ⚡'
        );


        ocultarError();

        mostrarLoading(
          false
        );


        renderizarResultados(
          cacheBusquedas[queryLower],
          query
        );


        return;
      }


      // ----------------------------------------------------------
      // NUEVA BÚSQUEDA
      // ----------------------------------------------------------

      ocultarResultados();

      ocultarError();

      mostrarLoading(
        true
      );


      socket.emit(
        'buscar_canciones',
        query
      );

    }


    // ============================================================
    // RENDERIZAR RESULTADOS
    // ============================================================

    function renderizarResultados(
      items,
      query
    ) {

      resultsList.innerHTML =
        '';


      if (
        !items ||
        items.length === 0
      ) {

        resultsList.innerHTML =
          '<p class="no-results">Sin resultados. Prueba con otra búsqueda.</p>';


        resultsSection.classList.remove(
          'is-hidden'
        );


        return;
      }


      resultsQuery.textContent =
        `"${query}"`;


      items.forEach(
        (item, index) => {

          const videoId =
            item.videoId;


          if (!videoId) {
            return;
          }


          const titulo =
            item.title ||
            'Sin título';


          const canal =
            item.author?.name ||
            'Canal desconocido';


          const thumb =
            DomSafe.sanitizeThumbnailUrl(
              item.thumbnail || ''
            );


          const card =
            document.createElement(
              'div'
            );


          card.className =
            'result-card card';


          card.setAttribute(
            'role',
            'listitem'
          );


          card.style.animationDelay =
            `${index * 0.05}s`;


          card.innerHTML = `

            ${
              thumb

              ? `
                <img
                  class="result-thumb"
                  src="${escapeHtml(thumb)}"
                  alt="${escapeHtml(titulo)}"
                  loading="lazy"
                >
              `

              : `
                <div
                  class="result-thumb result-thumb-placeholder"
                >
                  🎵
                </div>
              `
            }


            <div class="result-info">

              <div
                class="result-title"
                title="${escapeHtml(titulo)}"
              >
                ${escapeHtml(titulo)}
              </div>


              <div class="result-channel">
                ${escapeHtml(canal)}
              </div>


              <button
                class="btn-add"
                data-video-id="${escapeHtml(videoId)}"
                data-titulo="${escapeHtml(titulo)}"
                data-thumb="${escapeHtml(thumb)}"
                aria-label="Añadir ${escapeHtml(titulo)} a la fila"
              >
                ➕ Añadir a la Fila
              </button>

            </div>

          `;


          resultsList.appendChild(
            card
          );

        }
      );


      resultsSection.classList.remove(
        'is-hidden'
      );


      resultsList
        .querySelectorAll('.btn-add')
        .forEach(
          btn => {

            btn.addEventListener(
              'click',
              () => {

                manejarAgregarCancion(
                  btn
                );

              }
            );

          }
        );

    }


    // ============================================================
    // AGREGAR CANCIÓN
    // ============================================================

    function manejarAgregarCancion(btn) {

      const nombre =
        inputNombre.value.trim();


      // ----------------------------------------------------------
      // VALIDAR NOMBRE
      // ----------------------------------------------------------

      if (!nombre) {

        inputNombre.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });


        inputNombre.focus();


        inputNombre.classList.add(
          'input-shake'
        );


        setTimeout(
          () => {

            inputNombre.classList.remove(
              'input-shake'
            );

          },
          500
        );


        mostrarError(
          '⚠️ Escribe tu nombre o número de mesa primero.'
        );


        return;
      }


      // ----------------------------------------------------------
      // VALIDAR BAR
      // ----------------------------------------------------------

      if (!barSeleccionado) {

        mostrarError(
          '⚠️ No se pudo identificar el bar. Escanea nuevamente el código QR.'
        );


        return;
      }


      // ----------------------------------------------------------
      // VALIDAR SOCKET
      // ----------------------------------------------------------

      if (!socket.connected) {

        mostrarError(
          '⚠️ Sin conexión con el servidor. Espera un momento e inténtalo nuevamente.'
        );


        return;
      }


      // ----------------------------------------------------------
      // GUARDAR NOMBRE
      // ----------------------------------------------------------

      safeLocalStorageSet(
        clientNameStorageKey(),
        nombre
      );


      // ----------------------------------------------------------
      // CREAR CANCIÓN
      // ----------------------------------------------------------

      const cancion = {

        videoId:
          btn.dataset.videoId,

        titulo:
          btn.dataset.titulo,

        nombre:
          nombre,

        thumbnail:
          btn.dataset.thumb

      };


      // ----------------------------------------------------------
      // DESHABILITAR BOTÓN
      // ----------------------------------------------------------

      btn.disabled =
        true;


      btn.textContent =
        '⏳ Añadiendo...';


      btn.classList.add(
        'btn-add-pending'
      );


      // ----------------------------------------------------------
      // ENVIAR AL SERVIDOR
      //
      // El socket ya está asociado al bar.
      // ----------------------------------------------------------

      socket.emit(
        'agregar_cancion',
        cancion
      );

    }


    // ============================================================
    // MOSTRAR ÉXITO
    // ============================================================

    function mostrarExito(titulo) {

      successSongName.textContent =
        titulo;


      ocultarResultados();


      successOverlay.classList.add(
        'overlay-visible'
      );


      setTimeout(
        () => {

          btnSuccessClose.focus();

        },
        400
      );

    }


    // ============================================================
    // CERRAR ÉXITO
    // ============================================================

    btnSuccessClose.addEventListener(
      'click',
      () => {

        successOverlay.classList.remove(
          'overlay-visible'
        );


        inputBuscar.value =
          '';


        inputBuscar.focus();

      }
    );


    // ============================================================
    // ACTUALIZAR COLA
    // ============================================================

    function actualizarColaEnVivo(cola) {

      if (
        !cola ||
        cola.length === 0
      ) {

        liveQueueSection.classList.add(
          'is-hidden'
        );


        return;
      }


      liveQueueSection.classList.remove(
        'is-hidden'
      );


      liveQueueList.innerHTML =
        cola
          .map(
            (c, i) => `

              <div
                class="live-queue-item"
                role="listitem"
              >

                <span
                  class="lq-num"
                  aria-hidden="true"
                >
                  ${i + 1}
                </span>


                <div class="lq-info">

                  <div class="lq-title">
                    ${escapeHtml(c.titulo)}
                  </div>


                  <div class="lq-who">
                    📍 ${escapeHtml(c.nombre)}
                    ·
                    ${escapeHtml(c.timestamp)}
                  </div>

                </div>

              </div>

            `
          )
          .join('');

    }


    // ============================================================
    // LOADING
    // ============================================================

    function mostrarLoading(visible) {

      loadingState.classList.toggle(
        'is-hidden',
        !visible
      );

    }


    // ============================================================
    // MOSTRAR ERROR
    // ============================================================

    function mostrarError(msg) {

      errorMessage.textContent =
        msg;


      errorState.classList.remove(
        'is-hidden'
      );


      errorState.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });


      clearTimeout(
        mostrarError._timer
      );


      mostrarError._timer =
        setTimeout(
          ocultarError,
          5000
        );

    }


    // ============================================================
    // OCULTAR ERROR
    // ============================================================

    function ocultarError() {

      errorState.classList.add(
        'is-hidden'
      );

    }


    // ============================================================
    // OCULTAR RESULTADOS
    // ============================================================

    function ocultarResultados() {

      resultsSection.classList.add(
        'is-hidden'
      );


      resultsList.innerHTML =
        '';

    }


    // ============================================================
    // ESCAPAR HTML
    // ============================================================

    function escapeHtml(str) {

      if (!str) {
        return '';
      }


      return String(str)
        .replace(
          /&/g,
          '&amp;'
        )
        .replace(
          /</g,
          '&lt;'
        )
        .replace(
          />/g,
          '&gt;'
        )
        .replace(
          /"/g,
          '&quot;'
        )
        .replace(
          /'/g,
          '&#39;'
        );

    }


    // ============================================================
    // BÚSQUEDA AUTOMÁTICA
    // ============================================================

    let timerBusqueda =
      null;


    inputBuscar.addEventListener(
      'input',
      (e) => {

        clearTimeout(
          timerBusqueda
        );


        const query =
          e.target.value.trim();


        if (
          query.length === 0
        ) {

          ocultarResultados();

          return;
        }


        if (
          query.length >= 3
        ) {

          timerBusqueda =
            setTimeout(
              () => {

                buscarVideos(
                  query
                );

              },
              300
            );

        }

      }
    );


    // ============================================================
    // BOTÓN BUSCAR
    // ============================================================

    btnBuscar.addEventListener(
      'click',
      () => {

        clearTimeout(
          timerBusqueda
        );


        buscarVideos(
          inputBuscar.value
        );

      }
    );


    // ============================================================
    // ENTER EN BÚSQUEDA
    // ============================================================

    inputBuscar.addEventListener(
      'keydown',
      (e) => {

        if (
          e.key === 'Enter'
        ) {

          e.preventDefault();


          clearTimeout(
            timerBusqueda
          );


          buscarVideos(
            inputBuscar.value
          );

        }

      }
    );


    // ============================================================
    // ENTER EN NOMBRE / MESA
    // ============================================================

    inputNombre.addEventListener(
      'keydown',
      (e) => {

        if (
          e.key === 'Enter'
        ) {

          e.preventDefault();


          inputBuscar.focus();

        }

      }
    );
