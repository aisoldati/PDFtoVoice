# 🎧 VozPDF — Lector Inteligente de Documentos PDF por Voz

**VozPDF** es una aplicación de lectura asistida por voz de alto rendimiento para documentos PDF, diseñada tanto para ejecución web como para escritorio en Windows (**`VozPDF.exe`** autónomo sin dependencias externas).

---

## ✨ Características Principales

- ⚡ **Extracción PDF Ultra-Rápida y 100% Offline**: Procesamiento en paralelo por lotes mediante `pdfjs-dist` con worker empaquetado localmente en memoria (`Blob`), unión inteligente de palabras cortadas por salto de línea y barra de progreso en tiempo real.
- 🗣️ **Síntesis de Voz con Sincronización Palabra por Palabra**:
  - Resaltado en vivo de la palabra y oración activa con desplazamiento automático suave (*auto-scroll*).
  - Priorización inteligente de voces neurales/naturales en español y selector global para todos los idiomas del sistema.
  - Sincronización híbrida compatible tanto con voces que emiten eventos `onboundary` como con voces SAPI5 tradicionales.
- 🎛️ **Control en Tiempo Real sin Interrupciones**:
  - Ajuste instantáneo de **Velocidad (`0.5x` a `2.5x`)**, **Volumen** y **Narrador** en medio de la reproducción sin perder la palabra actual.
  - Navegación interactiva: clic en cualquier párrafo para leer desde ese punto, salto directo por página, retroceso/avance de `15s` y cambio por oración.
- 🔍 **Buscador Integrado y Marcador Automático**:
  - Búsqueda instantánea de términos o frases en todo el documento con salto directo a la oración y página correspondiente.
  - Persistencia automática en `localStorage` del progreso de lectura de cada archivo PDF.
- 🚀 **Renderizado Virtualizado (`60 FPS`) y Modo Enfoque**:
  - Ventana deslizante virtualizada que mantiene el DOM ligero incluso en libros de cientos de páginas.
  - **Modo Libro** (texto completo interactivo) y **Modo Enfoque** (concentración en la oración activa).
- 🖥️ **Ejecutable Nativo para Windows (`VozPDF.exe`)**:
  - Binario ligero (`~2.1 MB`) compilado en C# (`.NET Framework`) con manifiesto `asInvoker` y empaquetado autónomo sin abrir puertos de red.

---

## ⌨️ Atajos de Teclado

| Atajo | Acción |
| :--- | :--- |
| `Espacio` | Reproducir / Pausar |
| `←` / `→` | Oración anterior / siguiente |
| `Shift + ←` / `Shift + →` | Retroceder / Adelantar 15 segundos |
| `↑` / `↓` | Aumentar / Reducir velocidad de lectura (`±0.1x`) |

---

## 🛠️ Stack Tecnológico

- **Frontend**: React 19 + TypeScript + Vite 6
- **Estilos y Animaciones**: Tailwind CSS 4 + Motion + Lucide Icons
- **Motor PDF**: Mozilla `pdfjs-dist` (Web Worker inline autónomo)
- **Empaquetado Windows**: Lanzador nativo C# (`scripts/Launcher.cs` + `scripts/build-exe.ps1`)

---

## 🚀 Instalación y Uso

### 1. Ejecución directa en Windows
Descarga y ejecuta **[`VozPDF.exe`](./VozPDF.exe)** directamente. No requiere instalar Node.js ni conexión a internet.

### 2. Desarrollo local desde el código fuente
```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev

# Compilar versión web de producción
npm run build

# Generar ejecutable independiente VozPDF.exe para Windows
npm run build:exe
```

---

## 📁 Estructura del Proyecto

```text
├── src/
│   ├── App.tsx                 # Interfaz principal, controles TTS, virtualización y buscador
│   ├── main.tsx                # Punto de entrada de React
│   ├── services/
│   │   └── pdfService.ts       # Extracción paralela de PDF y segmentación de oraciones
│   └── lib/
│       └── utils.ts            # Utilidades de clases CSS
├── scripts/
│   ├── Launcher.cs             # Host nativo de Windows (.exe) sin sockets de red
│   ├── app.manifest            # Manifiesto UAC (asInvoker) de Windows
│   └── build-exe.ps1           # Script de empaquetado y firma digital para Windows
└── VozPDF.exe                  # Ejecutable autónomo listo para usar en Windows
```

---

## 📄 Licencia

Distribuido bajo la licencia **Apache-2.0**. Desarrollado por [@aisoldati](https://github.com/aisoldati).
