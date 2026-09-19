    'use strict';
// Oculta thumbnails rotos sin usar manejadores inline (compatible con CSP estricta).
document.addEventListener('error', (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement && target.matches('.admin-thumb, .queue-thumb, .result-thumb, .live-queue-thumb')) {
    target.style.display = 'none';
  }
}, true);


    let barActual = null;
    let barId = null;
    let player       = null;  
    let playerReady  = false;  
    let pendingVideo = null;   
    let notifTimer   = null;   
    let lastVideoId  = null;
    let historialReproducidas = []; // 🔥 NUEVO: Historial local para Auto-DJ
    let isAutoDJ     = false;  

    // Variables para el control de la Cola y Barrido
    let totalCancionesAnterior = 0;
    let intervaloBarrido = null;
    let timeoutReinicio = null; 
    let tiempoDescanso = 30000; // 30 segundos de espera entre barridos

    const isEsclavo  = new URLSearchParams(window.location.search).has('esclavo');
    let pendingAutoDJ = false;

    // Semillas AutoDJ (fallback si historial vacío)
    const semillasMix = [
      'nJ7rBzClyCg', 'Qk7rhW-SB1g', 'D14H7qE1Tq0', 'y9Q30K7xLko', 
      'c8mP91kZ9C8', 'Wj6HkY10Y9U', 'z_a9OvhN168', '5R-7E5u2t8U', 
      'wDeZiEZGS3Q', 'W0Wc3eQ0Y5k', 'lM0D-l3w-X0', 'R5j71wB27cE', 
      'a-H_h2v4O0I', 'ca48oMV59LU', 'TapXs54Ah3E', '2aD2hYg1_n8', 
      'eHhLzHofkE8', 'I_mQv7-QIfs', 'eM6A7gJ_U2Y', 'G8v7gBWe3c4'
    ];

    const socket = io({ reconnectionDelay: 1000, autoConnect: false });

    async function inicializarPantallaBar() {
      barActual = await BarLoader.inicializarBar({
        titulo: 'GENESIS 2.0 — Pantalla',
        mensajeSinSlug: 'Abre esta pantalla con la URL del bar, por ejemplo: /bar.html?bar=mi-bar'
      });

      if (!barActual) {
        return;
      }

      barId = barActual.id;

      try {
        await OperatorAuth.iniciarSesionOperador({ slug: barActual.slug, socket, titulo: 'Acceso a la pantalla del bar' });
      } catch (error) {
        BarLoader.mostrarErrorPantalla(error.message, 'Acceso de operador');
        return;
      }

      const qrImg = document.getElementById('bar-qr-img');

      if (qrImg) {
        qrImg.src = `/api/public/bars/${encodeURIComponent(barActual.slug)}/qr`;
        qrImg.alt = `QR para ${barActual.name}`;
      }

      BarLoader.conectarSocketBar(socket, barId);
    }

    socket.on('estado_inicial', ({ cola, reproduciendo, historialReproducidas: hist }) => {
      if (hist && hist.length > 0) {
        historialReproducidas = hist;
      }
      actualizarCola(cola);
      if (reproduciendo) {
        cargarVideo(reproduciendo);
      } else {
        if (!isEsclavo) {
          lastVideoId = obtenerSemillaDelHistorial();
          if (playerReady) iniciarAutoDJ();
          else pendingAutoDJ = true; 
        } else {
          mostrarIdleScreen(true);
        }
      }
    });

    socket.on('cola_actualizada', ({ cola, reproduciendo }) => {
      actualizarCola(cola);
      if (reproduciendo) actualizarNowPlayingBar(reproduciendo);

      if (!reproduciendo) {
        if (lastVideoId && !isAutoDJ) {
          if (!isEsclavo) iniciarAutoDJ();
        } else if (!lastVideoId && !isAutoDJ) {
          actualizarNowPlayingBar(null);
          mostrarIdleScreen(true);
        }
      }
    });

    socket.on('nueva_reproduccion', (cancion) => {
      isAutoDJ = false;
      cargarVideo(cancion);
      mostrarNotificacion(cancion);
    });

    // 🔥 NUEVO: Escuchar actualizaciones del historial
    socket.on('historial_actualizado', ({ historialReproducidas: hist }) => {
      if (hist && hist.length > 0) {
        historialReproducidas = hist;
        console.log('📜 Historial actualizado:', hist.length, 'canciones');
      }
    });

    socket.on('reconnect', () => {
      if (barId) {
        socket.emit('solicitar_estado', { barId });
      }
    });

    window.onYouTubeIframeAPIReady = function () {
      player = new YT.Player('youtube-player', {
        height: '100%', width: '100%',
        playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, playsinline: 1, enablejsapi: 1 },
        events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange, onError: onPlayerError }
      });
    };

    function onPlayerReady(event) {
      playerReady = true;
      if (pendingVideo) {
        cargarVideo(pendingVideo);
        pendingVideo = null;
      } else if (pendingAutoDJ && !isEsclavo) {
        iniciarAutoDJ();
        pendingAutoDJ = false;
      }
    }

    function onPlayerStateChange(event) {
      if (event.data === YT.PlayerState.ENDED) {
        // 🔥 NUEVO: Registrar la canción que terminó de reproducirse
        if (player.getVideoData && player.getVideoData()) {
          const videoData = player.getVideoData();
          if (videoData.video_id && !isAutoDJ) {
            socket.emit('cancion_terminada', {
              barId,
              cancion: {
                videoId: videoData.video_id,
                titulo: videoData.title || 'Desconocida',
                nombre: '(Registrada)'
              }
            });
          }
        }
        if (!isAutoDJ && !isEsclavo) {
          socket.emit('siguiente_cancion', { barId });
        }
      } else if (event.data === YT.PlayerState.PLAYING) {
        mostrarIdleScreen(false);
        if (isAutoDJ && player.getVideoData) {
          const videoData = player.getVideoData();
          if (videoData && videoData.title) {
            actualizarNowPlayingBar({ titulo: videoData.title, nombre: '🔥 Auto-DJ (Mix personalizado)' });
          }
        }
      }
    }

    function onPlayerError(event) {
      if (!isEsclavo) {
        setTimeout(() => socket.emit('siguiente_cancion', { barId }), 2000);
      }
    }

    function cargarVideo(cancion) {
      if (!cancion) return;
      if (!playerReady || !player || typeof player.loadVideoById !== 'function') {
        pendingVideo = cancion; return;
      }
      lastVideoId = cancion.videoId;
      player.loadVideoById({ videoId: cancion.videoId });
      actualizarNowPlayingBar(cancion);
      mostrarIdleScreen(false);
    }

    // 🔥 NUEVA FUNCIÓN: Obtener semilla del historial
    function obtenerSemillaDelHistorial() {
      if (historialReproducidas && historialReproducidas.length > 0) {
        // Seleccionar una canción aleatoria del historial para mayor variedad
        const semilla = historialReproducidas[Math.floor(Math.random() * historialReproducidas.length)];
        console.log(`🎲 Semilla Auto-DJ del historial: "${semilla.titulo}"`);
        return semilla.videoId;
      }
      // Fallback: semillas predefinidas
      const seed = semillasMix[Math.floor(Math.random() * semillasMix.length)];
      console.log('🎲 Usando semilla fallback (historial vacío)');
      return seed;
    }

    function iniciarAutoDJ() {
      if (!playerReady || !player) return;
      isAutoDJ = true;
      mostrarIdleScreen(false);
      player.loadPlaylist({ list: 'RD' + lastVideoId, listType: 'playlist' });
      actualizarNowPlayingBar({ titulo: 'Cargando mix personalizado...', nombre: '🔥 Auto-DJ' });
    }

    function mostrarIdleScreen(visible) {
      const el = document.getElementById('idle-screen');
      if (el) el.style.display = visible ? 'flex' : 'none';
    }

    function actualizarNowPlayingBar(cancion) {
      const tituloEl = document.getElementById('np-titulo');
      const nombreEl = document.getElementById('np-nombre');
      const sepEl    = document.getElementById('np-sep');

      if (!cancion) {
        tituloEl.textContent  = '— Esperando canciones —';
        nombreEl.textContent  = '';
        sepEl.style.display   = 'none';
        return;
      }
      tituloEl.textContent = cancion.titulo;
      nombreEl.textContent = cancion.nombre;
      sepEl.style.display  = 'inline';
    }

    // ─────────────────────────────────────────────────────────
    //  NÚCLEO DE LA MAGIA VISUAL: BARRIDO Y AGRUPACIÓN
    // ─────────────────────────────────────────────────────────
    function actualizarCola(cola) {
      const listEl  = document.getElementById('queue-list');
      const emptyEl = document.getElementById('queue-empty');
      const qrSection = document.getElementById('seccion-qr'); 

      const hayCancionNueva = cola.length > totalCancionesAnterior;
      totalCancionesAnterior = cola.length;

      listEl.querySelectorAll('.queue-item').forEach(el => el.remove());

      if (cola && cola.length >= 4) {
        if (qrSection) qrSection.classList.add('qr-oculto');
      } else {
        if (qrSection) qrSection.classList.remove('qr-oculto');
      }

      if (!cola || cola.length === 0) {
        emptyEl.style.display = 'block';
        detenerCicloBarrido(listEl);
        return;
      }

      emptyEl.style.display = 'none';

      const colaAgrupada = [];
      cola.forEach(cancion => {
        let existente = colaAgrupada.find(c => c.videoId === cancion.videoId);
        if(existente) {
          existente.cantidad = (existente.cantidad || 1) + 1;
        } else {
          colaAgrupada.push({ ...cancion, cantidad: 1 });
        }
      });

      colaAgrupada.forEach((cancion, index) => {
        const item = document.createElement('div');
        item.className = 'queue-item';
        
        if (hayCancionNueva && index === colaAgrupada.length - 1) {
          item.classList.add('resaltar-nueva');
        }

        const number = document.createElement('div');
        number.className = 'queue-num';
        number.textContent = String(index + 1);

        const thumbSafe = DomSafe.sanitizeThumbnailUrl(
          cancion.thumbnail || ''
        );

        let thumb;

        if (thumbSafe) {
          thumb = document.createElement('img');
          thumb.className = 'queue-thumb';
          thumb.src = thumbSafe;
          thumb.alt = '';
          thumb.loading = 'lazy';
        } else {
          thumb = document.createElement('div');
          thumb.className = 'queue-thumb-placeholder';
          thumb.textContent = '🎵';
        }

        const details = document.createElement('div');
        details.className = 'queue-details';

        const title = document.createElement('div');
        title.className = 'queue-song-title';
        title.append(
          document.createTextNode(
            String(cancion.titulo || '')
          )
        );

        if (cancion.cantidad > 1) {
          const multiplier = document.createElement('span');
          multiplier.className = 'badge-multiplicador';
          multiplier.textContent = `(x${cancion.cantidad})`;
          title.append(' ', multiplier);
        }

        const requestedBy = document.createElement('div');
        requestedBy.className = 'queue-song-who';
        requestedBy.append(
          document.createTextNode(
            `Pedido por: ${String(cancion.nombre || '')}`
          )
        );

        if (
          hayCancionNueva &&
          index === colaAgrupada.length - 1
        ) {
          const newBadge = document.createElement('span');
          newBadge.className = 'badge-nueva';
          newBadge.textContent = '¡Nueva!';
          requestedBy.append(' ', newBadge);
        }

        details.append(title, requestedBy);
        item.append(number, thumb, details);
        listEl.appendChild(item);
      });

      // LÓGICA DE BARRIDO ACTUALIZADA (Solo si hay 8 o más)
      if (cola.length >= 8) {
        setTimeout(() => iniciarCicloBarrido(listEl, hayCancionNueva), 50);
      } else {
        detenerCicloBarrido(listEl);
      }
    }

    // Funciones de control del barrido inteligente con JS
    function iniciarCicloBarrido(listEl, forzarInmediato) {
      clearInterval(intervaloBarrido); 
      clearTimeout(timeoutReinicio);

      const ejecutarAnimacion = () => {
        const contenedor = listEl.parentElement;
        const alturaVisible = contenedor.offsetHeight;
        const alturaTotal = listEl.scrollHeight;
        
        if (alturaTotal > alturaVisible) {
          const distanciaScroll = alturaTotal - alturaVisible + 20;
          
          // 🧠 LÓGICA INTELIGENTE DE TIEMPO AJUSTADA
          const cantCanciones = listEl.children.length; 
          // Base de 5s. Si hay más de 10 canciones, suma medio segundo (0.5) por cada una adicional.
          const tiempoBarrido = cantCanciones > 10 ? 5 + ((cantCanciones - 10) * 0.5) : 5;
          const tiempoPausa = 2; // 2 segundos exactos detenida abajo para poder leerla perfectamente
          
          // 1. Reseteo instantáneo al inicio
          listEl.style.transition = 'none';
          listEl.style.transform = 'translateY(0)';
          clearTimeout(timeoutReinicio);

          // 2. Forzamos Reflow
          void listEl.offsetWidth; 

          // 3. Ejecutamos el barrido con el tiempo inteligente calculado
          listEl.style.transition = `transform ${tiempoBarrido}s linear`;
          listEl.style.transform = `translateY(-${distanciaScroll}px)`;

          // 4. Programamos el regreso contemplando el tiempo de bajada + la pausa de 2s
          timeoutReinicio = setTimeout(() => {
            listEl.style.transition = 'none';
            listEl.style.transform = 'translateY(0)';
          }, (tiempoBarrido + tiempoPausa) * 1000);
        }
      };

      if (forzarInmediato) {
        ejecutarAnimacion();
      }

      intervaloBarrido = setInterval(ejecutarAnimacion, tiempoDescanso);
    }

    function detenerCicloBarrido(listEl) {
      clearInterval(intervaloBarrido);
      clearTimeout(timeoutReinicio);
      listEl.style.transition = 'none';
      listEl.style.transform = 'translateY(0)';
    }

    function mostrarNotificacion(cancion) {
      if (!cancion) return;
      const banner   = document.getElementById('notification-banner');
      const songName = document.getElementById('notif-song-name');
      const quien    = document.getElementById('notif-quien');

      songName.textContent = cancion.titulo;
      quien.textContent    = cancion.nombre;

      banner.classList.remove('notif-show', 'notif-hide');
      void banner.offsetWidth;
      banner.classList.add('notif-show');

      clearTimeout(notifTimer);
      notifTimer = setTimeout(() => {
        banner.classList.remove('notif-show');
        banner.classList.add('notif-hide');
      }, 5000);
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const logoSection = document.querySelector('.bar-logo-section');
    if (logoSection) {
      logoSection.style.cursor = 'pointer'; 
      logoSection.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => console.error(err));
        } else {
          document.exitFullscreen();
        }
      });
    }

    inicializarPantallaBar();
