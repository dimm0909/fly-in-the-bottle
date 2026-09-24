# Разработка

## Структура проекта

```text
main.js                     # Electron: окно, меню, настройки, IPC, режим скриншота
preload.js                  # мост window.widget между рендерером и главным процессом
brain-host.js               # процесс-хозяин сайдкара мозга и его протокол
package.json                # npm-скрипты
src/
  index.html                # страница, import map, CSP
  app.js                    # сцена, мышь, главный цикл кадра
  jar.js                    # банка, шейдер стекла, крышка, этикетка, тень
  env.js                    # процедурная «студия»: отражения (GLSL + PMREM)
  flymodel.js               # тело мухи: меши, скелет, IK ног
  fly.js                    # сценарная муха и общая механика (столкновения, поза, звук)
  brainfly.js               # муха с мозгом
  brainlink.js              # связь рендерера с сайдкаром
  motion.js                 # физика банки как целого
  audio.js                  # синтез звука
assets/fly/
  meshes/*.stl              # 39 мешей NeuroMechFly v2 (Apache-2.0)
  rig.json                  # скелет, собранный из rigging.yaml
  LICENSE-flygym.txt        # лицензия мешей
brain/
  brain.h                   # интерфейс Backend, Params, Graph, Group
  cpu.cpp                   # загрузка графа и групп, CpuBackend (событийный)
  main.cpp                  # протокол stdin/stdout
  Makefile                  # собирает data/brain/brain
tools/
  setup_brain.sh            # загрузка данных и сборка мозга одной командой
  build_brain_graph.py      # граф data/brain/graph.bin и neurons.feather
  build_groups.py           # именованные группы нейронов data/brain/groups.txt
  build_fly_rig.py          # assets/fly/rig.json из data/nmf/rigging.yaml
  brain_client.py           # Python-клиент сайдкара для исследований и тестов
  check_brain.py            # проверки сайдкара (npm run brain:check)
  bench_brain.py            # замер стоимости счёта
  explore/                  # эксперименты калибровки (explore1.py ... explore10.py)
docs/                       # эта документация (Sphinx)
data/                       # git-ignored: данные MaleCNS, граф, бинарник мозга, скелет NeuroMechFly
shots/                      # git-ignored: кадры режима --shot
.venv/                      # git-ignored: окружение Python
```

## Проверки

Автоматических тестов на JS нет; работа виджета проверяется тестовым стендом `--shot` (см.
[launch_modes](launch_modes.md)), а мозг - скриптом `npm run brain:check`.

### Мозг

```bash
npm run brain:check                       # контроль поведения сайдкара (9 проверок)
.venv/bin/python tools/bench_brain.py     # стоимость счёта в нескольких режимах
```

После правок `brain/`, параметров модели или правил групп проверьте оба. Если менялось усиление, адаптация
или шаг, перезапустите `tools/explore/explore3.py`, `explore5.py` и `explore8.py` и сравните с таблицами из
[brain_model](brain_model.md).

### Виджет

Шаблон проверки в странице: скрипт выполняется в главном мире страницы с доступом к `window.__w`, возвращает
объект и делает снимок.

| Что проверить | Как |
| --- | --- |
| Внешний вид | `--shot=out.png --delay=800`, при необходимости `--script` с позой мухи, затем просмотр PNG на светлом и тёмном фоне |
| Тычок в часть тела | `w.fly.touch('lf_tibia', 0.3)`; смотреть `w.fly.power`, `w.fly.state`, `leg.twitch` за 1-2 секунды |
| Приближающийся курсор | `w.fly.threat.strength = 1; w.fly.threat.side = 'R'` каждые 30 мс |
| Покой | 30 с без событий: муха должна стоять неподвижно (фоновый шум инертен, см. [brain_model](brain_model.md)) |
| Долгий прогон | 120 с со случайными касаниями, стуками и приближениями: нет NaN, муха не выходит за стенки (`maxR` < внутреннего радиуса), мозг не отстаёт (`link.simMs` ≈ реальному времени) |
| Запасной режим | `--no-brain`: состояния `fly`, `approach`, `perch` сменяют друг друга без NaN |
| Ввод мыши | `PointerEvent` с `pointerId` и `screenX/screenY`, отправленные на `canvas` внутри страницы; `window.__w.pick(x, y)` возвращает `fly`, `lid`, `glass` или `null` |

Пример: тычок в каждую часть тела на свежепосаженной мухе.

```js
(async () => {
  const w = window.__w, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  for (const part of ['c_head', 'c_thorax', 'c_abdomen4', 'lf_tibia', 'l_arista']) {
    w.fly.beginStand('floor', new w.THREE.Vector3(0.1, 0, 0.3));
    w.fly.power = 0;
    await sleep(2500);                       // дать мозгу успокоиться
    w.fly.touch(part, 0.2);
    let peak = 0;
    for (let i = 0; i < 15; i++) { await sleep(100); peak = Math.max(peak, w.fly.power); }
    rows.push(`${part}: power ${peak.toFixed(2)}`);
  }
  return rows;
})()
```

### Документация

```bash
npm run docs                       # полная пересборка
.venv/bin/sphinx-build -W -b html -E docs docs/_build/html   # то же с предупреждениями как ошибками
```

## Как сделать

### Новую группу нейронов

1. Допишите правило в `tools/build_groups.py` (функции `add(name, mask)` и `sided(name, mask, side_column)` берут
   маску по таблице `neurons`).
2. `.venv/bin/python tools/build_groups.py`: перезапись `data/brain/groups.txt`; пересобирать граф не нужно.
3. Перезапустите виджет. Сайдкар читает группы при старте.
4. Для чтения или подачи тока обращайтесь по имени группы: `link.rate('имя')` и словарь `drive` в `sense()`.

### Новое воздействие на муху

Добавьте событие (`fly.addEvent(группы, мВ, длительность)`) или постоянное условие в `BrainFly.sense()`. Проверьте,
что нужная группа существует (`noise` и `drive` молча пропускают неизвестные имена). Уровень подберите
экспериментом в Python (`tools/explore/*`): смотрите, чтобы отклик был градуирован, а не всплеск на всю сеть.

### Новое действие мухи

Прочитайте пул в `BrainFly.read()` (`link.rate('mn_…')`), придайте ему сглаживание и превратите в поворот сустава,
скорость или позу. Не добавляйте в код правил вида «если …, то взлететь»: поведение должно следовать из
активности пулов.

### Другой порог связей или знаки

`.venv/bin/python tools/build_brain_graph.py --min-syn 3` (по умолчанию 5). Правило знаков - словарь `SIGN` в
скрипте. После пересборки нужно заново пройти калибровку: общее усиление зависит от плотности графа.

### Другое тело

Замените или дополните меши в `assets/fly/meshes/`, положите соответствующий `rigging.yaml` в `data/nmf/` и
выполните `.venv/bin/python tools/build_fly_rig.py`. Позы стойки и полёта (`STANCE`, `TUCK`), масштаб (`MM`) и
высота тела (`GROUND_MM`) лежат в `src/flymodel.js`.

## Подводные камни

Всё это уже встречалось.

| Проблема | Причина и что делать |
| --- | --- |
| `TypeError … reading 'handle'`, вывод про `Node.js v24` | `ELECTRON_RUN_AS_NODE` в окружении (терминалы из VS Code). `env -u ELECTRON_RUN_AS_NODE …` |
| Процесс завершается с кодом 9 | Передан `--debug`; используйте `--dev`. |
| Окно пустое без ошибок | Нет `--no-sandbox` (см. [quickstart](quickstart.md)). |
| Страница не находит `three` | Изменился текст import map, а хеш в CSP старый; скопируйте хеш из сообщения консоли. |
| `fetch('file://…')` в рендерере | Считается ненадёжным (в проекте не проверялось), поэтому файлы читает `window.widget.readAsset` через IPC. |
| Анимация в скрытом окне почти стоит | Chromium почти не даёт кадров окну без показа (около 1 кадра в секунду). Тестовый режим потому и показывает окно за экраном. |
| `pkill -f` убил и мою оболочку | Шаблон совпал с командной строкой самой оболочки. Используйте `pkill -x electron` или трюк со скобкой `[e]lectron`. |
| Мозг «взлетает» на старте | Сеть не прогрета; `link.init(restingDrive(), …)` должен вызываться до создания мухи. |

```{warning}
Не отправляйте синтетический ввод (`xdotool` и подобное) на настоящий рабочий стол, чтобы проверить виджет:
ввод попадёт в то окно, которое там окажется (VS Code, игра). Однажды скрипт, не нашедший окно виджета,
отправил на реальный экран клики и Escape. Проверяйте ввод событиями `PointerEvent`, отправленными на
`canvas` внутри страницы; чтение состояния (`xdotool search`, `xprop`, `xwininfo`) безопасно.
```

## Сопровождение документации

Как в проекте-образце (`rl-simulator`): изменение поведения, флагов или параметров сопровождается правкой README и
страницы в `docs/`. Новую страницу добавляют в `toctree` в `docs/index.md`; новый модуль - в карту модулей на
[api/index](api/index.md). Каталоги `docs/_build/` и `docs/api/generated/` создаются сборкой и не хранятся в git.
