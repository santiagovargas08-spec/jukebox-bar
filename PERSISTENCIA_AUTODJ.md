# Historial persistente y perfil musical del Auto DJ

## Qué guarda el sistema

Cada reproducción se registra antes de emitir el evento `nueva_reproduccion`. El registro conserva videoId, título, artista identificado, géneros detectados, época cuando se puede inferir, duración, origen, solicitante y fecha de reproducción.

El índice anti-repetición y el perfil musical se reconstruyen desde todos los registros al arrancar. El historial visible en la interfaz sigue siendo una ventana reciente; no limita la memoria anti-repetición.

## Configuración local

En desarrollo local se conserva el archivo JSONL:

- `JUKEBOX_DATA_DIR`: directorio donde guardar el historial.
- `JUKEBOX_REQUIRE_PERSISTENCE`: usa `true` (predeterminado) para bloquear reproducción si no se puede persistir. Solo usa `false` en pruebas o desarrollo temporal.

Por defecto, el archivo se crea en `data/historial-canciones.jsonl`. La carpeta `data/` está excluida de Git; no subas el historial del bar al repositorio del código.

## Configuración de Render Free con GitHub privado

Render Free no dispone de discos persistentes. En Render, Jukebox Bar usa un repositorio GitHub privado separado del repositorio público del código.

Configura en Render → servicio web → Environment:

- `GITHUB_TOKEN`: Fine-grained Personal Access Token; mantenerlo como secreto.
- `GITHUB_HISTORY_REPO`: propietario/repositorio privado, por ejemplo `santiagovargas08-spec/jukebox-bar-data`.
- `GITHUB_HISTORY_BRANCH`: rama de almacenamiento; predeterminado `main`.
- `GITHUB_HISTORY_DIRECTORY`: carpeta para segmentos; predeterminado `history`.
- `GITHUB_HISTORY_FILE`: nombre base del archivo; predeterminado `historial-canciones.jsonl`. Se crean segmentos numerados, por ejemplo `historial-canciones-000001.jsonl`.

El token debe tener acceso únicamente al repositorio privado de datos y permiso **Contents: Read and write**. Nunca guardes el token en el código, en un archivo del repositorio ni en el historial.

Al iniciar, el servidor valida que el repositorio exista y sea privado, descarga los segmentos y reconstruye la memoria completa antes de abrir el puerto HTTP. Si el token, el repositorio o la lectura fallan, el servidor no inicia: no continúa con un historial vacío.

### Escritura y segmentación

Los registros se guardan en `history/historial-canciones-000001.jsonl`, `historial-canciones-000002.jsonl`, etc. (el prefijo se obtiene de `GITHUB_HISTORY_FILE`). Cada segmento contiene hasta 100 reproducciones. Las escrituras se serializan, usan el SHA actual del archivo y reintentan conflictos de actualización. Un segmento nuevo se crea al completar el anterior.

Cada reproducción genera un commit en el repositorio privado. Esto permite que el historial sobreviva a reinicios y despliegues del contenedor gratuito. GitHub no es una base de datos: es una solución de persistencia para el piloto y una sola instancia del jukebox. Tiene límites de API, latencia y crecimiento del historial/commits. Para varios bares o mayor volumen, migra a una base de datos administrada con aislamiento por bar.

Si GitHub no confirma el guardado, la canción no se anuncia al televisor y el servidor emite `error_reproduccion`. No se debe desactivar el modo estricto para ocultar un fallo de almacenamiento.

## Solicitudes del público vs. Auto DJ

Las solicitudes recibidas desde el QR pueden volver a pedir canciones que ya fueron reproducidas. Cuando esas solicitudes se reproducen, se registran nuevamente en el historial persistente. Solo se rechazan si la misma canción ya está sonando o ya se encuentra en la fila pública.

El Auto DJ mantiene una política distinta: nunca recomienda ni reproduce canciones que ya aparecen en el historial, incluso si YouTube las devuelve con otro videoId, canal o etiqueta. El registro remoto se confirma antes de emitir la reproducción, por lo que un fallo de GitHub bloquea el inicio en lugar de perder la memoria anti-repetición.

## Cómo se identifica una canción

La huella musical normaliza acentos, mayúsculas, puntuación y etiquetas de publicación (Official Video, Audio, Lyrics, HD, Remastered, Live, etc.). Separa título y artista cuando los metadatos lo permiten y compara palabras del título, no solo el artista. Un mismo artista con canciones distintas no se considera duplicado por compartir su nombre.

La comparación textual no puede demostrar identidad acústica cuando YouTube entrega títulos y canales engañosos o sin metadatos. Para acercarse a una garantía acústica se necesitaría fingerprinting de audio (procesar el audio y compararlo con una base de huellas). El servidor no descarga ni analiza el audio de YouTube actualmente.
