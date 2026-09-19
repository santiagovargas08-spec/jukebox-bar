    'use strict';

    let barId = null;
    let barActual = null;

    const socket = io({ autoConnect: false });

    // ELEMENTOS DEL DOM
    const boxReproduciendo = document.getElementById('box-reproduciendo');
    const listaCola        = document.getElementById('lista-cola');
    const countCola        = document.getElementById('count-cola');
    const btnVaciar        = document.getElementById('btn-vaciar');
    
    const inputBuscarAdmin = document.getElementById('input-buscar-admin');
    const btnBuscarAdmin   = document.getElementById('btn-buscar-admin');
    const adminResults     = document.getElementById('admin-results');

    // ─────────────────────────────────────────────────────────
    //  ESCUCHAR ESTADOS DEL SERVIDOR
    // ─────────────────────────────────────────────────────────
    socket.on('estado_inicial', (data) => actualizarPanel(data));
    socket.on('cola_actualizada', (data) => actualizarPanel(data));

    function actualizarPanel({ cola, reproduciendo }) {
      // 1. Renderizar canción actual
      if (reproduciendo) {
        const thumbSrc = DomSafe.safeThumbnailAttr(reproduciendo.thumbnail);
        const thumbHtml = thumbSrc
          ? `<img class="admin-thumb" src="${thumbSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="admin-thumb" style="display:flex;align-items:center;justify-content:center;font-size:2rem;">🎵</div>`;

        boxReproduciendo.innerHTML = `
          <div class="now-playing-box">
            ${thumbHtml}
            <div class="track-details">
              <div class="track-title">${escapeHtml(reproduciendo.titulo)}</div>
              <div class="track-author">Pedida por: <strong style="color:var(--neon-admin);">${escapeHtml(reproduciendo.nombre)}</strong> · Fila: ${escapeHtml(reproduciendo.timestamp)}</div>
            </div>
            <button class="btn-admin" id="btn-saltar">⏭️ Saltar</button>
          </div>
        `;
        document.getElementById('btn-saltar').addEventListener('click', () => {
          socket.emit('admin_saltar', { barId });
        });
      } else {
        boxReproduciendo.innerHTML = `<div class="empty-msg">No hay ninguna canción reproduciéndose en este momento.</div>`;
      }

      // 2. Renderizar fila de espera
      countCola.textContent = cola.length;
      if (cola.length === 0) {
        listaCola.innerHTML = `<div class="empty-msg">La fila de espera está vacía.</div>`;
        return;
      }

      // ✨ Añadido draggable y drag-handle para reordenar
      listaCola.innerHTML = cola.map((c, index) => `
        <div class="admin-queue-item" draggable="true" data-id="${c.id}">
          <div class="drag-handle" title="Arrastrar para mover">☰</div>
          <div style="flex:1; padding-right:10px;">
            <div style="font-weight:bold; font-size:1rem;">${index + 1}. ${escapeHtml(c.title || c.titulo)}</div>
            <div style="color:#666; font-size:0.85rem;">📍 Mesa/Nombre: <span style="${c.name === '👑 DJ / Admin' || c.nombre === '👑 DJ / Admin' ? 'color:var(--neon-admin);' : ''}">${escapeHtml(c.name || c.nombre)}</span></div>
          </div>
          <button class="btn-delete-item" data-id="${c.id}">❌</button>
        </div>
      `).join('');

      // Eventos para borrar canciones
      listaCola.querySelectorAll('.btn-delete-item').forEach(btn => {
        btn.addEventListener('click', () => {
          socket.emit('admin_eliminar_cancion', {
            barId,
            id: Number(btn.dataset.id)
          });
        });
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
    //  BUSCADOR DEL DJ (CON DEBOUNCE OPTIMIZADO: 300ms)
    // ─────────────────────────────────────────────────────────
    let timerBusquedaAdmin = null;

    inputBuscarAdmin.addEventListener('input', (e) => {
      clearTimeout(timerBusquedaAdmin);
      const q = e.target.value.trim();
      
      if (q.length >= 3) {
        adminResults.innerHTML = '<div class="empty-msg">Buscando en YouTube... ⏳</div>';
        timerBusquedaAdmin = setTimeout(() => {
          socket.emit('buscar_canciones', q);
        }, 300); // ⚡ DEBOUNCE: 300ms para evitar spam de búsquedas
      }
    });

    btnBuscarAdmin.addEventListener('click', () => {
      clearTimeout(timerBusquedaAdmin);
      const q = inputBuscarAdmin.value.trim();
      if (q) {
        adminResults.innerHTML = '<div class="empty-msg">Buscando en YouTube... ⏳</div>';
        socket.emit('buscar_canciones', q);
      }
    });

    inputBuscarAdmin.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timerBusquedaAdmin);
        const q = inputBuscarAdmin.value.trim();
        if (q) {
          adminResults.innerHTML = '<div class="empty-msg">Buscando en YouTube... ⏳</div>';
          socket.emit('buscar_canciones', q);
        }
      }
    });

    // Recibir resultados del buscador
    socket.on('resultados_busqueda', ({ items }) => {
      if (document.activeElement === inputBuscarAdmin || inputBuscarAdmin.value !== '') {
        if (!items || items.length === 0) {
          adminResults.innerHTML = '<div class="empty-msg">Sin resultados.</div>';
          return;
        }

        adminResults.innerHTML = items.slice(0, 5).map((item) => {
          const thumbSrc = DomSafe.safeThumbnailAttr(item.thumbnail);
          const thumbHtml = thumbSrc
            ? `<img class="admin-thumb" src="${thumbSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : `<div class="admin-thumb" style="display:flex;align-items:center;justify-content:center;">🎵</div>`;

          return `
          <div class="admin-queue-item">
            ${thumbHtml}
            <div style="flex:1; padding-right:10px;">
              <div style="font-weight:bold; font-size:0.9rem;">${escapeHtml(item.title)}</div>
            </div>
            <button class="btn-admin btn-add-dj" 
              data-id="${escapeHtml(item.videoId)}" 
              data-title="${escapeHtml(item.title)}" 
              data-thumb="${escapeHtml(DomSafe.sanitizeThumbnailUrl(item.thumbnail) || '')}">
              ➕ Añadir
            </button>
          </div>
        `;
        }).join('');

        // Eventos para añadir la canción como DJ
        adminResults.querySelectorAll('.btn-add-dj').forEach(btn => {
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
            
            adminResults.innerHTML = `<div class="empty-msg" style="color:var(--neon-admin);">¡Canción añadida a la fila con éxito! 🎵</div>`;
            inputBuscarAdmin.value = '';
          });
        });
      }
    });

    socket.on('error_busqueda', () => {
      if (inputBuscarAdmin.value !== '') {
        adminResults.innerHTML = '<div class="empty-msg" style="color:var(--neon-danger);">Error en la búsqueda.</div>';
      }
    });

    // ─────────────────────────────────────────────────────────
    //  VACIAR COLA COMPLETA
    // ─────────────────────────────────────────────────────────
    btnVaciar.addEventListener('click', () => {
      if (confirm("¿Estás seguro de que quieres borrar TODAS las canciones de la lista de espera?")) {
        socket.emit('admin_vaciar_cola', { barId });
      }
    });

    async function inicializarAdmin() {
      barActual = await BarLoader.inicializarBar({
        titulo: 'GENESIS 2.0 — Admin',
        mensajeSinSlug: 'Abre el panel con la URL del bar, por ejemplo: /admin.html?bar=mi-bar'
      });

      if (!barActual) {
        return;
      }

      barId = barActual.id;

      try {
        await OperatorAuth.iniciarSesionOperador({ slug: barActual.slug, socket, titulo: 'Acceso al panel del bar' });
      } catch (error) {
        BarLoader.mostrarErrorPantalla(error.message, 'Acceso de operador');
        return;
      }

      const titulo = document.querySelector('.admin-title');

      if (titulo) {
        titulo.innerHTML = `GENESIS 2.0 <span>${BarLoader.escapeHtml(barActual.name)}</span>`;
      }

      BarLoader.conectarSocketBar(socket, barId);
    }

    inicializarAdmin();

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
