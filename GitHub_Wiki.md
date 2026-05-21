# Wiki del Reproductor de Video Adaptativo (P1 GDIE)

¡Bienvenido a la Wiki del Reproductor de Video Adaptativo! 

Este proyecto consiste en un reproductor de video web personalizado que implementa tecnologías avanzadas de transmisión de video, como **HLS** y **MPEG-DASH**. Además, destaca por integrar metadatos interactivos sincronizados a través de pistas WebVTT. 

En esta wiki se detallan en profundidad las implementaciones realizadas, justificando las decisiones técnicas y tecnológicas adoptadas en el proyecto.

---

## 📖 Índice

1. [Obtención y Preparación de los Elementos Multimedia](#1-obtención-y-preparación-de-los-elementos-multimedia)
2. [Preparación de Entorno](#2-preparación-de-entorno)
3. [Reproductor Propio](#3-reproductor-propio)
4. [Uso de IA Offline para Creación de Metadatos y Subtítulos](#4-uso-de-ia-offline-para-creación-de-metadatos-y-subtítulos)
5. [Implementación de Subtítulos y Capítulos con WebVTT](#5-implementación-de-subtítulos-y-capítulos-con-webvtt)
6. [Implementación Semántica y Sincronización de Metadatos](#6-implementación-semántica-y-sincronización-de-metadatos)
7. [Implementación del Selector de Calidad (HLS/DASH/CMAF)](#7-implementación-del-selector-de-calidad-hlsdashcmaf)
8. [Plan de Pruebas](#8-plan-de-pruebas)

---

## 1. Obtención y Preparación de los Elementos Multimedia

Para garantizar una experiencia óptima y compatibilidad en la web, el contenido original (video e imágenes) fue procesado y adaptado exhaustivamente utilizando herramientas de línea de comandos, destacando el uso de **FFmpeg**.

### 1.1 Procesamiento de Video con FFmpeg
Los videos originales suelen venir en formatos o bitrates no aptos para la transmisión web directa, por lo que se empleó FFmpeg para llevar a cabo una transcodificación y empaquetado del contenido. Se generaron múltiples variaciones del video original, adaptando las resoluciones y bitrates para asegurar un streaming adaptativo fluido. Principalmente se utilizó el códec de video **H.264** y el formato de audio **AAC**, que representan un estándar de extrema compatibilidad en medios web. Adicionalmente, para un rendimiento moderno de alta eficiencia, se implementó el formato alternativo a mp4 mediante contenedores **WebM** emparejando el códec de video **VP9** junto al audio **Opus**.

#### FFmpeg mp4
```bash
ffmpeg -i video_original.webm -c:v libx264 -crf 23 -c:a aac -s 1920x1080 video_1080p.mp4 -c:v libx264 -crf 23 -c:a aac -s 1280x720 video_720p.mp4 -c:v libx264 -crf 23 -c:a aac -s 640x360 video_360p.mp4
```

#### FFmpeg webm 
```bash
ffmpeg -i video_original.webm -c:v libvpx-vp9 -crf 23 -c:a libopus -s 1920x1080 video_1080p.webm -c:v libvpx-vp9 -crf 23 -c:a libopus -s 1280x720 video_720p.webm -c:v libvpx-vp9 -crf 23 -c:a libopus -s 640x360 video_360p.webm
```

El paso más relevante de este procesamiento fue el empaquetado del contenido bajo la especificación estructural **CMAF** (Common Media Application Format). Esta estandarización metodológica permite desplegar unos *mismos* fragmentos divididos de medios (`.m4s`) tanto para las operativas de HLS como para MPEG-DASH. Gracias a esto, se logran mitigar de manera drástica los requisitos de almacenamiento, recortar los ciclos de procesamiento doble y evitar por completo alojar fragmentos redundantes en el lado del servidor.

#### FFmpeg mp4 fragmentado (CMAF)

```bash
ffmpeg -i video_1080p.mp4 -i video_720p.mp4 -i video_360p.mp4 \-map 0:v:0 -map 1:v:0 -map 2:v:0 -map 0:a:0 \
  -c:v libx264 -preset medium -crf 20 \
  -g 50 -keyint_min 50 -sc_threshold 0 \
  -c:a aac -b:a 128k \
  -f dash \
  -seg_duration 2 \
  -ldash 1 \
  -streaming 1 \
  -use_template 1 \
  -use_timeline 1 \
  -hls_playlist 1 \
  -dash_segment_type mp4 \
  -f cmaf \
  manifest.mpd
```

### 1.2 Preparación de Imágenes
Las imágenes asociadas a componentes dinámicos, como pueden ser las visualizaciones tácticas de formación, y los banners centrales, influyen notoriamente en el desempeño general y la consistencia visual. Para prevenir distorsiones originadas por la naturaleza adaptativa de los componentes web (responsive design), cada recurso gráfico fue manipulado buscando proporciones óptimas. Se procedió a utilizar dimensiones estandarizadas, salvaguardando la calidad resolutiva a la par que se minimizaba la carga en kilobytes.

Para la preparación de imágenes se utilizó la herramienta **ImageMagick**, la cual permite manipular imágenes de manera eficiente. Los formatos utilizados has sido **webp** y **png**, procurando utilizar una resolución parecida entre imágenes para mantener la consistencia visual.

---

## 2. Preparación de Entorno

El despliegue funcional de un contenedor con características de streaming asíncrono involucra una serie de validaciones previas de servidor y permisos, dado que conformarse solamente con un HTML provocaría lecturas fallidas.

### 2.1 Conexión vía SFTP al Servidor Remoto
La carga y manipulación de los medios transcodificados se realizó gestionando la conexión del servidor a distancia. Se recurrió exclusivamente al uso de perfiles de enlace seguro **SFTP** (SSH File Transfer Protocol). La decisión obedece a garantizar la estabilidad e integridad criptográfica en las subidas masivas requeridas al transportar cientos de instancias modulares pequeñas e interdependientes (archivos extraídos en formato `.m4s` o extensiones asociadas al manifest como `.m3u8`).

### 2.2 Verificación de Tipos MIME y CORS
La gestión de *streaming* requiere que el motor del servidor remoto sepa identificar la arquitectura de entregas fragmentadas. Si el servidor ignora las configuraciones MIME (Multipurpose Internet Mail Extensions), el host se paraliza frente a recursos de streaming forzando la desestimación por el navegador destino. Además, estrictos filtros de resguardo en la cabecera navegador cortan peticiones asíncronas no validadas cuando el origen no empareja.

Por estos motivos, el servidor se configuró asignando de forma expresa los encabezados para dar de alta en **Tipos MIME** específicos: indicando `application/vnd.apple.mpegurl` para orientar archivos `.m3u8` (HLS), `application/dash+xml` para rutas `.mpd` (DASH), `video/mp4` para archivos `.mp4, .m4s` y la tipología base `text/vtt` para la correcta extracción de pistas extra.
Para contrarrestar el bloqueo normativo en peticiones foráneas y posibilitar la recuperación nativa de segmentos asíncronos mediante librerías javascript (Hls.js y Dash.js), se implantaron y ratificaron políticas de flexibilidad cruzada **CORS** (Cross-Origin Resource Sharing), anexando validaciones críticas como las sentencias `Access-Control-Allow-Origin: *`.

---

## 3. Reproductor Propio

Apostar por depender de esquemas rígidos predeterminados provistos por la mera inyección simple `<video>` inhibiría sustancialmente el potencial evolutivo de la arquitectura. Se forjó, en su lugar, la construcción de un `custom-video-player` nativo íntegramente impulsado por flujos estándar y limpios de control desde cero. 
Este control granular concedió total destreza para moldear una responsividad milimétrica, conservar simetría estética entre navegadores dominantes e integrar complejas superposiciones, como la conmutación al vuelo de los *streams* o interfaces completas adaptadas a pistas y variables informativas.

### Elementos Desarrollados:
- **Botones Dinámicos (Play/Pause, Volumen, Fullscreen):** Se construyó una vinculación limpia a las APIs HTML5 intrínsecas a las funciones *Media*. Los distintos botones reflejan visual y estéticamente las transiciones del sistema manteniéndose en paralelo con los comportamientos base, respondiendo sincronizadamente al ratón y teclado gracias a la monitorización constante de observadores (`play`, `pause`, `volumechange`). 
- **Barra de Progreso Interactiva:** Un elemento principal dotado de visualización en directo nutrida por los impulsos del evento general `timeupdate` sobre el ratio fragmentado actual. La barra absorbe las entradas físicas e interacciones de *click/drag* transformando esta lectura en un recalculo para desplazar dinámicamente la secuencia en el tiempo deseado (operativas seek).
- **Desplegables Modulares:** Para agrupar cómodamente el exceso de utilidades adicionales (idiomas, calidades de red nativa), se articuló un modelo DOM que encubre y revela jerárquicas pestañas modulares por encima del layout sin oscurecer ni ensuciar la representación fundamental bajo diseños inspirados en patrones *glassmorphism*.
- **Indicadores de Capítulos Integrados:** Se forjó la funcionalidad de lectura en tiempo real para plasmar explícitamente en el segmento del layout de control, cuál de los apartados situacionales o epigramas se hallan actualmente en plena vigencia para contextualizar a los observadores con celeridad asombrosa.

---

## 4. Uso de IA Offline para Creación de Metadatos y Subtítulos

Gran parte del esfuerzo analítico destinado a la gestoría y articulación del marco informativo subyacente a la narrativa fue potenciado de forma exhaustiva valiéndose de herramientas modernas ligadas a Inteligencia Artificial configuradas *offline*.

- **Generación y Traducción de Subtítulos:** Para la generación de subtítulos base se utilizó el modelo **Whisper** integrado a través de la herramienta **Subtitle Edit**, lo que permitió asimilar transcripciones de texto fidedignas extrayendo el audio original y generando automáticamente su respectivo archivo `.vtt`. Posteriormente, este archivo base sirvió como sustento para procesar las traducciones a otros idiomas asistidas por el modelo avanzado **Gemini 3.1 Pro**.
- **Obtención de Timestamps de Capítulos:** Se proporcionó directamente el archivo de video al modelo **Gemini 3.1 Pro**, el cual lo analizó para detectar de forma automática los cambios de escena. A partir de este análisis visual y de contexto, la IA determinó los hitos clave y generó de manera automatizada el archivo `.vtt` de capítulos con las marcas de *timestamps* precisas.
- **Generación de Archivo VTT con Secciones JSON:** Se proporcionó a **Gemini 3.1 Pro** el archivo VTT de capítulos generado previamente, junto con el listado de imágenes disponibles y la información táctica deseada para cada hito. Con este contexto contextual, la IA estructuró y creó el archivo VTT de metadatos, inyectando código JSON coherente y estrictamente validado dentro de cada *cue* para controlar la representación visual semántica de las formaciones tácticas a lo largo del video.

---

## 5. Implementación de Subtítulos y Capítulos con WebVTT

Toda inyección y emparejamiento con el motor *timeline* base recae en las especificaciones homologadas bajo el estándar de pistas suplementarias **WebVTT** (Web Video Text Tracks).

La inclusión a nivel técnico se consuma adjuntando las declaraciones orgánicas a través de múltiples etiquetas `<track>` empalmadas a modo de nodos bajo el flujo del contenedor de video. Cada variante posee etiquetas y propiedades exclusivas dictaminadas por su atributo organizativo:

```html
<track src="media/chapters.vtt" kind="chapters" srclang="es" label="Capítulos">
<track src="media/subtitles_es.vtt" kind="subtitles" srclang="es" label="Español (ES)" default>
```

- **Pista de Subtítulos (`subtitles`):** Se gestiona mediante JavaScript para permitir al usuario activarla o desactivarla desde el menú. Técnicamente, esto se logra cambiando la propiedad `mode` de la pista de subtítulos entre `showing` (visible) y `hidden` (oculto).
- **Pista de Capítulos (`chapters`):** Mediante JavaScript, el reproductor lee los tiempos y nombres definidos en esta pista a través de la propiedad `textTracks`. Esta información se utiliza principalmente para integrar de forma visual los marcadores de los capítulos sobre la barra de progreso del reproductor, facilitando al usuario la navegación por las distintas secciones del video.

---

## 6. Implementación Semántica y Sincronización de Metadatos

Esta es la parte más avanzada de la integración. En lugar de mostrar textos estáticos o simples subtítulos en la pantalla inferior, la interfaz (como los paneles laterales del reproductor) se actualiza de forma constante y dinámica basándose en la línea de tiempo del video.

Puesto que la información a mostrar es compleja (como diagramas de formaciones tácticas, imágenes y estadísticas), se requería una sincronización entre el estado del video y los elementos visuales externos. Para lograr esto, se implementó el siguiente sistema:

1. Se adjunta una pista de metadatos oculta (`kind="metadata"`, `mode='hidden'`) al video.
2. Dentro de esta pista, cada "capítulo" contiene información estructurada en formato JSON. Este JSON incluye datos como títulos, URLs de imágenes (para gráficos o logos) y porcentajes.
3. Se utiliza un script de JavaScript que "escucha" los cambios en los capítulos del video (`cuechange`).
4. Cuando el video avanza a un nuevo capítulo, el script detecta el cambio, lee el JSON, lo procesa y actualiza los paneles laterales del reproductor en tiempo real con la información correspondiente (mostrando los gráficos, textos y estadísticas definidos en el JSON).

---

## 7. Implementación del Selector de Calidad (HLS/DASH/CMAF)

Para implementar el *Adaptive Bitrate Streaming* (ABR) y asegurar que el video se reproduzca correctamente en todos los dispositivos, se utilizaron dos protocolos principales:

- **HLS:** Es necesario para los dispositivos de Apple, ya que sistemas como iOS lo requieren y soportan de forma nativa.
- **MPEG-DASH:** Utilizado como protocolo principal en navegadores de escritorio, gracias a su gran soporte y naturaleza *Open Source*.
- **MP4 y WebM Clásicos:** Se mantienen archivos `.mp4` y `.webm` estáticos como método de seguridad (*fallback*) y alternativa de alta eficiencia por si los protocolos de streaming anteriores fallaran en navegadores más antiguos o específicos.

Como se mencionó anteriormente, gracias al contenedor **CMAF**, tanto HLS como DASH comparten los mismos fragmentos de video, ahorrando así mucho espacio de almacenamiento en el servidor.

**Funcionamiento Técnico del Selector:**
A nivel de código, el reproductor detecta primero desde qué dispositivo se está accediendo:
- Si es un entorno compatible estándar (como un PC), el script utiliza la librería `dash.js` para cargar el manifiesto `.mpd`.
- Si detecta un entorno Apple (o no es compatible con DASH), utiliza el motor nativo de iOS o la librería externa `hls.js` para cargar el manifiesto `.m3u8`.

A través del panel visual de calidades, el usuario interactúa directamente con esta lógica. Puede dejar marcado el modo "Automático" para que la propia librería (DASH o HLS) decida si subir o bajar la calidad en base a la conexión a internet, o puede seleccionar manualmente una resolución específica como 1080p, forzando la reproducción en esa calidad de manera constante.

---

## 8. Plan de Pruebas

Para asegurar la estabilidad del reproductor y la interfaz web, se llevaron a cabo pruebas para validar su comportamiento ante condiciones de red limitadas y rutinas de usuario exigentes:

- **Pruebas de Red (Throttling en DevTools):** Se simuló un ancho de banda bajo (perfil "Fast 3G" o menor) directamente desde las herramientas de desarrollador del navegador. Se comprobó que el reproductor ajustaba correctamente la calidad de video (por ejemplo, descendiendo de 1080p a 360p) de forma fluida, asegurando la continuidad y evitando los temidos bloqueos de carga prolongada (*buffering* infinito).
- **Pruebas Multi-Navegador y Dispositivos:** Se verificó que el diseño (la maquetación, colores y menús modulares) se mantuviera fiel independientemente del navegador (Chrome, Firefox o Safari). Además, se prestó especial atención en entornos Apple, comprobando que la detección del soporte nativo de HLS se realizara con éxito a través de la API `video.canPlayType`.
- **Sincronización al Saltar en el Tiempo (Seeking/Scrubbing):** Se hicieron pruebas de estrés moviendo la barra de progreso hacia adelante y hacia atrás con rapidez. De este modo nos aseguramos de que, incluso al dar saltos bruscos en el tiempo, se procesaran correctamente los eventos `cuechange`. Los paneles laterales, las descripciones y la barra de metadatos se actualizaron al instante, sin desincronizarse del estado del video.

---

*Desarrollado para la P1_GDIE*
