    'use strict';
// Oculta thumbnails rotos sin usar manejadores inline (compatible con CSP estricta).
document.addEventListener('error', (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement && target.matches('.admin-thumb, .queue-thumb, .result-thumb, .live-queue-thumb')) {
    target.style.display = 'none';
  }
}, true);


    let barId = null;
    let barActual = null;

    const socket = io({ autoConnect: false });

    // ELEMENTOS DEL DOM
    const boxReproduciendo = document.getElementById('box-reproduciendo');
    const listaCola        = document.getElementById('lista-cola');
    const countCola        = document.getElementById('count-cola');
    const btnVaciar        = document.getElementById('btn-vaciar');
const btnLogout        = document.getElementById('btn-logout-operator');
    
    const inputBuscarAdmin = document.getElementById('input-buscar-admin');
    const btnBuscarAdmin   = document.getElementById('btn-buscar-admin');
    const adminResults     = document.getElementById('admin-results');

    // ─────────────────────────────────────────────────────────
    //  ESCUCHAR ESTADOS DEL SERVIDOR
    // ─────────────────────────────────────────────────────────
    socket.on('estado_inicial', (data) => actualizarPanel(data));
    socket.on('cola_actualizada', (data) => actualizarPanel(data));

    function crearMensaje(texto, extraClass = '') {
      const message = document.createElement('div');
      message.className =
        `empty-msg${extraClass ? ` ${extraClass}` : ''}`;
      message.textContent = texto;
      return message;
    }

    function mostrarMensajeResultados(texto, extraClass = '') {
      adminResults.replaceChildren(
        crearMensaje(texto, extraClass)
      );
    }

    function actualizarPanel({ cola, reproduciendo }) {
      boxReproduciendo.replaceChildren();

      // 1. Renderizar canción actual
      if (reproduciendo) {
        const nowPlaying = document.createElement('div');
        nowPlaying.className = 'now-playing-box';

        const thumbSrc =
          DomSafe.safeThumbnailAttr(
            reproduciendo.thumbnail
          );

        let thumb;

        if (thumbSrc) {
          thumb = document.createElement('img');
          thumb.className = 'admin-thumb';
          thumb.src = thumbSrc;
          thumb.alt = '';
          thumb.loading = 'lazy';
        } else {
          thumb = document.createElement('div');
          thumb.className =
            'admin-thumb admin-thumb-placeholder admin-thumb-placeholder-lg';
          thumb.textContent = '🎵';
        }

        const details = document.createElement('div');
        details.className = 'track-details';

        const title = document.createElement('div');
        title.className = 'track-title';
        title.textContent =
          String(reproduciendo.titulo || '');

        const author = document.createElement('div');
        author.className = 'track-author';
        author.append(
          document.createTextNode('Pedida por: ')
        );

        const requester = document.createElement('strong');
        requester.className = 'admin-requester-dj';
        requester.textContent =
          String(reproduciendo.nombre || '');

        author.append(
          requester,
          document.createTextNode(
            ` · Fila: ${String(reproduciendo.timestamp || '')}`
          )
        );

        details.append(title, author);

        const skip = document.createElement('button');
        skip.className = 'btn-admin';
        skip.type = 'button';
        skip.textContent = '⏭️ Saltar';
        skip.addEventListener('click', () => {
          socket.emit('admin_saltar', { barId });
        });

        nowPlaying.append(
          thumb,
          details,
          skip
        );
        boxReproduciendo.appendChild(nowPlaying);
      } else {
        boxReproduciendo.appendChild(
          crearMensaje(
            'No hay ninguna canción reproduciéndose en este momento.'
          )
        );
      }

      // 2. Renderizar fila de espera
      countCola.textContent = String(cola.length);
      listaCola.replaceChildren();

      if (cola.length === 0) {
        listaCola.appendChild(
          crearMensaje(
            'La fila de espera está vacía.'
          )
        );
        return;
      }

      cola.forEach((song, index) => {
        const item = document.createElement('div');
        item.className = 'admin-queue-item';
        item.draggable = true;
        item.dataset.id = String(song.id);

        const handle = document.createElement('div');
        handle.className = 'drag-handle';
        handle.title = 'Arrastrar para mover';
        handle.textContent = '☰';

        const main = document.createElement('div');
        main.className = 'admin-item-main';

        const itemTitle = document.createElement('div');
        itemTitle.className = 'admin-item-title';
        itemTitle.textContent =
          `${index + 1}. ${String(song.title || song.titulo || '')}`;

        const meta = document.createElement('div');
        meta.className = 'admin-item-meta';
        meta.append(
          document.createTextNode('📍 Mesa/Nombre: ')
        );

        const requester = document.createElement('span');
        const requesterName =
          String(song.name || song.nombre || '');

        if (requesterName === '👑 DJ / Admin') {
          requester.className = 'admin-requester-dj';
        }

        requester.textContent = requesterName;
        meta.appendChild(requester);

        main.append(itemTitle, meta);

        const remove = document.createElement('button');
        remove.className = 'btn-delete-item';
        remove.type = 'button';
        remove.dataset.id = String(song.id);
        remove.textContent = '❌';
        remove.setAttribute(
          'aria-label',
          `Eliminar ${String(song.title || song.titulo || 'canción')}`
        );
        remove.addEventListener('click', () => {
          socket.emit('admin_eliminar_cancion', {
            barId,
            id: Number(remove.dataset.id)
          });
        });

        item.append(handle, main, remove);
        listaCola.appendChild(item);
      });

      // 🔥 Inicializamos los eventos de Drag & Drop
      configurarDragAndDrop();
    }

    // ─────────────────────────────────────────────────────────
    //  MAGIA DRAG & DROP
    // ─────────────────────────────────────────────────────────
    let elementoArrastrado = null;

    function configurarDragAndDrop() {
      const items = document.querySelectorAll('#lista-cola .admin-queue-item');

      items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
          elementoArrastrado = item;
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          elementoArrastrado = null;
          
          // Al soltar, enviamos el nuevo orden al servidor
          enviarNuevoOrdenAlServidor();
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault(); // Necesario para permitir soltar (drop)
          const elementoActivo = document.querySelector('.dragging');
          if (!elementoActivo || elementoActivo === item) return;

          // Determinar si soltamos arriba o abajo del elemento
          const rect = item.getBoundingClientRect();
          const offset = e.clientY - rect.top - (rect.height / 2);
          
          if (offset > 0) {
            item.parentNode.insertBefore(elementoActivo, item.nextSibling);
          } else {
            item.parentNode.insertBefore(elementoActivo, item);
          }
        });
      });
    }

    function enviarNuevoOrdenAlServidor() {
      // Obtenemos todos los IDs (c.id) de las tarjetas en su nuevo orden visual
      const nuevoOrdenIds = Array.from(document.querySelectorAll('#lista-cola .admin-queue-item'))
                                 .map(item => item.dataset.id);
      
      // Emitimos el evento. NOTA: Tu backend en Node.js debe escuchar 'reordenar_cola'
      // y organizar su array interno según este nuevo orden de IDs.
      socket.emit('reordenar_cola', {
        barId,
        orderedIds: nuevoOrdenIds.map(Number)
      });
    }

    // ─────────────────────────────────────────────────────────
    //  BUSCADOR DEL DJ
    //  Solo busca al pulsar Buscar o Enter.
    // ─────────────────────────────────────────────────────────
    const cacheBusquedasAdmin = new Map();
    const MAX_ADMIN_SEARCH_CACHE = 80;
    let searchRequestCounterAdmin = 0;
    let activeSearchRequestIdAdmin = '';

    function claveBusquedaAdmin(query) {
      return String(query || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    }

    function guardarCacheAdmin(query, items) {
      const key = claveBusquedaAdmin(query);
      if (!key || !Array.isArray(items)) return;

      cacheBusquedasAdmin.delete(key);
      cacheBusquedasAdmin.set(key, items);

      if (
        cacheBusquedasAdmin.size >
        MAX_ADMIN_SEARCH_CACHE
      ) {
        const oldestKey =
          cacheBusquedasAdmin.keys().next().value;
        cacheBusquedasAdmin.delete(oldestKey);
      }
    }

    function finalizarBusquedaAdmin() {
      btnBuscarAdmin.disabled = false;
      btnBuscarAdmin.removeAttribute('aria-busy');
    }

    function renderizarResultadosAdmin(items) {
      if (!items || items.length === 0) {
        mostrarMensajeResultados('Sin resultados.');
        return;
      }

      adminResults.replaceChildren();

      items.slice(0, 5).forEach((item) => {
        const row = document.createElement('div');
        row.className = 'admin-queue-item';

        const thumbSrc =
          DomSafe.safeThumbnailAttr(
            item.thumbnail
          );

        let thumb;

        if (thumbSrc) {
          thumb = document.createElement('img');
          thumb.className = 'admin-thumb';
          thumb.src = thumbSrc;
          thumb.alt = '';
          thumb.loading = 'lazy';
        } else {
          thumb = document.createElement('div');
          thumb.className =
            'admin-thumb admin-thumb-placeholder';
          thumb.textContent = '🎵';
        }

        const main = document.createElement('div');
        main.className = 'admin-item-main';

        const title = document.createElement('div');
        title.className =
          'admin-item-title admin-item-title-sm';
        title.textContent =
          String(item.title || '');

        main.appendChild(title);

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'btn-admin btn-add-dj';
        add.dataset.id = String(item.videoId || '');
        add.dataset.title = String(item.title || '');
        add.dataset.thumb =
          DomSafe.sanitizeThumbnailUrl(
            item.thumbnail
          ) || '';
        add.textContent = '➕ Añadir';

        row.append(
          thumb,
          main,
          add
        );

        adminResults.appendChild(row);
      });

      adminResults
        .querySelectorAll('.btn-add-dj')
        .forEach((btn) => {
          btn.addEventListener('click', () => {
            socket.emit('agregar_cancion', {
              barId,
              cancion: {
                videoId: btn.dataset.id,
                title: btn.dataset.title,
                name: '👑 DJ / Admin',
                thumbnail: btn.dataset.thumb
              }
            });

            mostrarMensajeResultados(
              '¡Canción añadida a la fila con éxito! 🎵',
              'empty-msg-success'
            );
            inputBuscarAdmin.value = '';
          });
        });
    }

    function emitirBusquedaAdmin(query) {
      const q = String(query || '').trim();
      if (!q || btnBuscarAdmin.disabled) return;

      searchRequestCounterAdmin += 1;
      activeSearchRequestIdAdmin =
        `admin-${searchRequestCounterAdmin}`;

      const requestId =
        activeSearchRequestIdAdmin;

      const cacheKey =
        claveBusquedaAdmin(q);

      const cachedItems =
        cacheBusquedasAdmin.get(cacheKey);

      if (cachedItems) {
        renderizarResultadosAdmin(cachedItems);
        finalizarBusquedaAdmin();
        return;
      }

      btnBuscarAdmin.disabled = true;
      btnBuscarAdmin.setAttribute(
        'aria-busy',
        'true'
      );

      mostrarMensajeResultados(
        'Buscando en YouTube... ⏳'
      );

      socket.emit('buscar_canciones', {
        query: q,
        requestId
      });
    }

    inputBuscarAdmin.addEventListener(
      'input',
      (e) => {
        if (!e.target.value.trim()) {
          searchRequestCounterAdmin += 1;
          activeSearchRequestIdAdmin =
            `admin-${searchRequestCounterAdmin}`;

          finalizarBusquedaAdmin();

          mostrarMensajeResultados(
            'Escribe artista o canción y pulsa Buscar.'
          );
        }
      }
    );

    btnBuscarAdmin.addEventListener(
      'click',
      () => {
        emitirBusquedaAdmin(
          inputBuscarAdmin.value
        );
      }
    );

    inputBuscarAdmin.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();

          emitirBusquedaAdmin(
            inputBuscarAdmin.value
          );
        }
      }
    );

    socket.on(
      'resultados_busqueda',
      ({ items, query, requestId }) => {
        if (
          requestId &&
          requestId !== activeSearchRequestIdAdmin
        ) {
          return;
        }

        finalizarBusquedaAdmin();

        if (query) {
          guardarCacheAdmin(
            query,
            items
          );
        }

        if (
          document.activeElement ===
            inputBuscarAdmin ||
          inputBuscarAdmin.value !== ''
        ) {
          renderizarResultadosAdmin(items);
        }
      }
    );

    socket.on(
      'error_busqueda',
      ({ mensaje, requestId, codigo }) => {
        if (
          requestId &&
          requestId !== activeSearchRequestIdAdmin
        ) {
          return;
        }

        finalizarBusquedaAdmin();

        if (codigo === 'COOLDOWN') {
          return;
        }

        if (inputBuscarAdmin.value !== '') {
          mostrarMensajeResultados(
            mensaje || 'Error en la búsqueda.',
            'empty-msg-error'
          );
        }
      }
    );

    socket.on('disconnect', () => {
      finalizarBusquedaAdmin();
    });

    // ─────────────────────────────────────────────────────────
    //  VACIAR COLA COMPLETA
    // ─────────────────────────────────────────────────────────
    btnVaciar.addEventListener('click', async () => {
      const confirmado = await AdminDialog.confirm(
        'Vaciar lista de espera',
        '¿Seguro que deseas borrar todas las canciones de la lista de espera?',
        {
          confirmText: 'Vaciar lista',
          danger: true
        }
      );

      if (confirmado) {
        socket.emit('admin_vaciar_cola', { barId });
      }
    });

    async function inicializarAdmin() {
      barActual = await BarLoader.inicializarBar({
        titulo: 'Jukebox Digital — Admin',
        mensajeSinSlug: 'Abre el panel con la URL del bar, por ejemplo: /admin.html?bar=mi-bar'
      });

      if (!barActual) {
        return;
      }

      try {
        const operator = await OperatorAuth.iniciarSesionOperador({
          slug: barActual.slug,
          socket,
          titulo: 'Acceso al panel del bar'
        });
        barId = operator.barId;
      } catch (error) {
        BarLoader.mostrarErrorPantalla(error.message, 'Acceso de operador');
        return;
      }

      BarLoader.aplicarMarcaBar(
        barActual,
        {
          titleSuffix:
            'Panel de Control',
          nameElementId:
            'admin-bar-name'
        }
      );

      BarLoader.conectarSocketBar(socket, {
        slug: barActual.slug,
        barId
      });
    }

    inicializarAdmin();

