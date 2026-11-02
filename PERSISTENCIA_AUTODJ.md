# Historial persistente y perfil musical del Auto DJ

## Qué guarda el sistema

Cada canción se registra en data/historial-canciones.jsonl antes de emitir el evento nueva_reproduccion. El registro conserva videoId, título, artista identificado, géneros detectados, época cuando se puede inferir, duración, origen y fecha de reproducción.

El archivo es de solo anexado. Al iniciar, el servidor reconstruye el índice de duplicados y el perfil musical desde todos los registros. El historial visible en la interfaz sigue siendo una ventana reciente; no limita la memoria anti-repetición.

Cada escritura se sincroniza con fsync. Si el almacenamiento deja de estar disponible, el modo estricto bloquea el inicio de nuevas canciones en vez de continuar sin registrar y arriesgar repeticiones. Si el archivo contiene líneas ilegibles, el servidor también se niega a iniciar en modo estricto para no olvidar canciones.

## Configuración local

Por defecto, el archivo se crea en data/historial-canciones.jsonl dentro del proyecto. La carpeta data/ está excluida de Git; no subas el historial de un bar al repositorio.

Variables disponibles:

- JUKEBOX_DATA_DIR: directorio donde guardar el historial.
- JUKEBOX_REQUIRE_PERSISTENCE: usa true (predeterminado) para bloquear reproducción si no se puede persistir. Solo usa false en pruebas o desarrollo temporal.

## Configuración necesaria en Render

El sistema de archivos del contenedor de Render puede ser efímero. Para conservar el historial entre despliegues y reinicios:

1. Abre el servicio web de Jukebox Bar en Render.
2. En Disks, crea un disco persistente.
3. Usa como punto de montaje /var/data.
4. En Environment, configura:
   - JUKEBOX_DATA_DIR=/var/data
   - JUKEBOX_REQUIRE_PERSISTENCE=true
5. Guarda los cambios y despliega el servicio.
6. Revisa los logs de inicio. Debe aparecer el número de reproducciones recuperadas desde /var/data/historial-canciones.jsonl.

El servidor detecta el entorno Render y no inicia si falta JUKEBOX_DATA_DIR, para evitar que se use silenciosamente el almacenamiento efímero. Si ya existe un historial en el contenedor anterior, copia data/historial-canciones.jsonl al disco persistente antes de retirar el despliegue anterior. Si no se migra, el servidor comenzará con un historial vacío.

Importante: el archivo JSONL local está pensado para una instancia de servidor por bar. No ejecutes varias instancias independientes compartiendo la misma cola o historial. Para escalar a varias instancias o administrar muchos bares desde un único servicio, conviene migrar a PostgreSQL con restricciones e índices únicos por bar.

## Cómo se identifica una canción

La huella musical normaliza acentos, mayúsculas, puntuación y etiquetas de publicación (Official Video, Audio, Lyrics, HD, Remastered, Live, etc.). Separa título y artista cuando los metadatos lo permiten y compara palabras del título, no solo el artista. Un mismo artista con canciones distintas no se considera duplicado por compartir su nombre.

La comparación textual no puede demostrar identidad acústica cuando YouTube entrega títulos y canales engañosos o sin metadatos. Para acercarse a una garantía acústica se necesitaría fingerprinting de audio (procesar el audio y compararlo con una base de huellas). El servidor no descarga ni analiza el audio de YouTube actualmente.
