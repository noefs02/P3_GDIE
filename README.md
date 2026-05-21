# Reproductor de Video Adaptativo (P1 GDIE)

Este proyecto es un reproductor de video web personalizado que implementa tecnologías de transmisión de video adaptativo (ABR) como HLS y MPEG-DASH. Además, incluye la sincronización de metadatos (como formaciones tácticas) a través de pistas de subtítulos WebVTT.

## Características

*   **Reproductor de Video HTML5**: Reproductor de video personalizado con controles básicos (play/pause, volumen, barra de progreso, etc.).
*   **Streaming Adaptativo**: Soporte para HLS (HTTP Live Streaming) y MPEG-DASH, permitiendo que la calidad del video se ajuste automáticamente según el ancho de banda del usuario.
*   **Selector de Calidad de Video**: Interfaz dinámica para cambiar entre resoluciones disponibles en los diferentes protocolos de streaming.
*   **Pistas de Subtítulos, Capítulos y Metadatos (WebVTT)**: Implementación de subtituos, capitulos y visualización de metadatos formativos de forma sincronizada.
*   **Servidor Express**: Servidor Node.js ligero configurado con Express que maneja los encabezados CORS necesarios y tipos MIME adecuados (`.m3u8`, `.mpd`, `.m4s`, `.vtt`) para la entrega correcta de segmentos de video adaptativo.
*   **Diseño Reactivo**: Interfaz moderna y adaptable a distintos tamaños de pantalla.

## Requisitos Previos

*   [Node.js](https://nodejs.org/) (versión 14 o superior recomendada)
*   NPM (incluido con Node.js)

## Tecnologías Utilizadas

*   **Frontend**: HTML5, CSS3 (Variables CSS para temas), Vanilla JavaScript
*   **Backend**: Node.js, Express.js
*   **Formatos Multimedia**: CMAF, HLS, MPEG-DASH, WebVTT

## Autores

*   Noé
*   Rafel
