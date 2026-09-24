# Справочник API

Справочник по модулям. JavaScript и C++ описаны вручную (страницы [javascript](javascript.md) и
[sidecar](sidecar.md)), а Python-модуль `brain_client` генерируется из исходников `autodoc`/`autosummary`
(страница [python](python.md)); там же перечислены скрипты из `tools/`.

## Как читать этот раздел

Каждая страница даёт для модуля:

- назначение;
- экспортируемые функции и классы с сигнатурами;
- ключевые поля и коллбэки;
- ограничения и взаимосвязи с другими модулями.

Если нужно быстро понять, где живёт конкретная логика, начните с таблиц ниже, а затем переходите на нужную
страницу.

## Карта модулей

### Главный процесс и мост

| Модуль | Что содержит | Для чего нужен |
| --- | --- | --- |
| `main.js` | окно, меню, настройки, масштаб, режим скриншота, IPC | Точка входа Electron. |
| `platform.js` | `windowOptions`, `applyLayer`, `isWin`, `isLinux` | Слой «на обоях» на Linux и Windows. |
| `tools/dev.js` | `start`, `setup-brain`, `compile-brain`, `py`, `docs` | Кроссплатформенный помощник за npm-скриптами. |
| `preload.js` | `window.widget` | Единственный канал рендерера наружу. |
| `brain-host.js` | `BrainHost`, `available()`, `FILES` | Запускает сайдкар мозга и говорит с ним по протоколу. |

### Рендерер

| Модуль | Что содержит | Для чего нужен |
| --- | --- | --- |
| `src/app.js` | сцена, `pick`, `frame`, `updateThreat` | Главный цикл, ввод мыши, склейка всех модулей. |
| `src/jar.js` | `createJar`, `JAR`, `outerRadiusAt`, `innerRadiusAt` | Банка, шейдер стекла, крышка, тень. |
| `src/env.js` | `studioEnvGLSL`, `createStudioEnvironment` | Процедурное освещение для отражений. |
| `src/flymodel.js` | `loadFlyAssets`, `buildFlyModel`, `solveLeg`, `MM`, `BODY_H`, `INNER_LAYER` | Тело мухи из мешей, скелет, IK ног. |
| `src/fly.js` | `Fly` | Сценарная муха и общая механика: столкновения, поза, звук. |
| `src/brainfly.js` | `BrainFly`, `touchGroups`, `restingDrive`, `ambientNoise` | Муха, управляемая мозгом. |
| `src/brainlink.js` | `BrainLink` | Асинхронная связь рендерера с сайдкаром. |
| `src/motion.js` | `JarMotion` | Качание, вращение и встряска банки. |
| `src/audio.js` | `Sound` | Синтез звука. |

### Сайдкар и Python

| Модуль | Что содержит | Для чего нужен |
| --- | --- | --- |
| `brain/brain.h` | `Params`, `Graph`, `Group`, `Backend` | Интерфейс симулятора. |
| `brain/cpu.cpp` | `load_graph`, `load_groups`, `CpuBackend` | Событийный CPU-бэкенд. |
| `brain/main.cpp` | протокол stdin/stdout | Команды сайдкара. |
| `tools/brain_client.py` | `Brain`, `show` | Python-клиент сайдкара. |
| `tools/*.py` | сборка графа, групп, тела мухи, проверки | Подготовка данных и контроль. |

```{toctree}
:maxdepth: 2

javascript
sidecar
python
```
