# JavaScript

Модули главного процесса (CommonJS) и рендерера (ES-модули). Единицы длины сцены - «единицы банки»
(см. [architecture](../architecture.md)); ось +x мухи - её левая сторона.

## main.js

Точка входа Electron. Экспортов нет.

| Что | Описание |
| --- | --- |
| `BASE`, `SCALE_MIN`, `SCALE_MAX`, `PRESETS` | Базовый размер окна (360×500 при масштабе 1), границы масштаба (0,5 и 3) и пресеты меню S/M/L (0,8; 1; 1,3). |
| `LAYERS`, `DEFAULTS` | Слои (`desktop`, `normal`, `top`) и настройки по умолчанию: `{ x, y, scale, layer, sound, brain }`. |
| `flag(name)` | Читает флаг `--name` или `--name=значение` из `process.argv`; `undefined`, если флага нет. Если флаг повторён, берётся последний. |
| `loadSettings()`, `saveSettings()` | Чтение и запись `settings.json` (старый ключ `size` переводится в `scale`); в режиме `--shot` запись отключена. |
| `createWindow()`, `recreateWindow()` | Создают окно (`platform.windowOptions` и `platform.applyLayer` задают слой); пересоздание нужно при смене слоя. |
| `applyScale(target)` | Меняет масштаб окна вокруг середины его нижней кромки; зажимает в 0,5-3, в размер экрана и запоминает. Вызывается пунктами меню и обработчиком `widget:zoom`. |
| `buildMenu()` | Собирает нативное меню: звук, мозг, размер (пресеты, текущий масштаб, сброс), положение, сброс положения, выход. |
| `runShot()` | Тестовый стенд `--shot`: ждёт `window.__w`, выполняет `--script`, ждёт `--delay`, сохраняет PNG и выходит. |
| `brain` | `{ start(), stop(), status() }`: жизненный цикл мозга (использует `BrainHost`). `status()` возвращает `{ available, enabled, running, error }`. |

IPC-обработчики перечислены на странице [architecture](../architecture.md).

## platform.js

Всё, что зависит от операционной системы при создании окна. Подробнее: [windows](../windows.md).

```js
const platform = require('./platform');
new BrowserWindow({ ..., ...platform.windowOptions(layer) });
const stop = platform.applyLayer(win, layer);   // stop() при закрытии окна
```

| Экспорт | Описание |
| --- | --- |
| `isWin`, `isLinux` | Флаги платформы. |
| `windowOptions(layer)` | Опции конструктора: на Linux для `desktop` `{ type: 'desktop' }`, на Windows `{ type: 'toolbar', focusable: false }`, иначе `{}`. |
| `applyLayer(win, layer)` | То, что опциями не задать: `top` -> `setAlwaysOnTop(true, 'screen-saver')`; вне Windows для `desktop` и `top` -> `setVisibleOnAllWorkspaces`; на Windows для `desktop` каждые 2 с `SetWindowPos(HWND_BOTTOM)` через необязательный `koffi`. Возвращает функцию остановки таймера. |

## tools/dev.js

Кроссплатформенный помощник, на который ссылаются все npm-скрипты (`node tools/dev.js <команда>`).

| Команда | Что делает |
| --- | --- |
| `start [аргументы]` | Запускает `electron .`, на Linux с `--no-sandbox`, без `ELECTRON_RUN_AS_NODE`; пробрасывает `SIGINT`/`SIGTERM`. |
| `setup-brain` | Скачивает три файла MaleCNS, создаёт `.venv`, ставит `pyarrow` и `pandas`, строит граф и группы, собирает сайдкар. |
| `compile-brain` | Только собирает сайдкар (`g++`, `c++`, `clang++`, на Windows `cl`, иначе `ziglang` из PyPI; переменная `CXX` выбирает компилятор). |
| `py <аргументы>` | Запускает интерпретатор `.venv` с этими аргументами. |
| `docs` | Ставит зависимости документации при необходимости и делает полную пересборку Sphinx. |

## preload.js

Выставляет в страницу объект `window.widget`.

| Метод | Возвращает | Описание |
| --- | --- | --- |
| `getSettings()` | `Promise<{ sound, scale, brain }>` | Настройки для рендерера. |
| `onSettings(callback)` | - | Подписка на изменения из меню. |
| `readAsset(relativePath)` | `Promise<Uint8Array>` | Читает файл из `assets/`. |
| `brainInfo()` | `Promise<{ backend, neurons, connections, groups, sizes } \| null>` | Сведения о мозге; `null`, если он не запущен. |
| `brainStep(drives, ms)` | `Promise<{ [группа]: число спайков } \| null>` | Токи (мВ по группам) → продвижение на `ms` → счётчики спайков. |
| `brainNoise(groups, rate)` | `Promise<void>` | Пуассоновский шум (Гц на нейрон) на группах. |
| `zoom(factor)` | - | Умножить масштаб окна на `factor` (обработчик колеса мыши). |
| `showMenu()` | - | Нативное меню. |
| `dragStart()`, `dragMove(dx, dy)`, `dragEnd()` | - | Перемещение окна. |

## brain-host.js

```js
const { BrainHost, available, FILES } = require('./brain-host');
```

| Что | Описание |
| --- | --- |
| `available()` | `true`, если на месте `data/brain/brain` (на Windows `brain.exe`), `graph.bin` и `groups.txt`. |
| `FILES` | Пути `{ binary, graph, groups }`; имя исполняемого файла зависит от платформы. |
| `new BrainHost()` | Хозяин процесса. Поля: `ready`, `names` (группы в порядке протокола), `sizes` (нейронов в группе). |
| `await host.start()` | Запускает процесс, ждёт `READY`, читает список групп; возвращает `{ backend, neurons, connections, groups, sizes }`. |
| `await host.step(drives, ms)` | Отправляет только изменившиеся `drive`, затем `advance ms`; возвращает объект счётчиков спайков по группам. Группы, которых нет в `drives`, отпускаются; неизвестные имена пропускаются. |
| `await host.noise(groups, rate)` | Постоянный пуассоновский шум на группах. |
| `host.send(line)` | Отправляет одну команду протокола, возвращает строку ответа. Ответы приходят по порядку, запросы можно конвейеризовать. |
| `host.stop()` | `quit` процессу, через 0,5 с `kill`. |

Если процесс завершился, все ожидающие запросы отклоняются ошибкой `brain exited`.

## src/app.js

Собирает всё вместе; экспортов нет. Использует верхнеуровневый `await` (загрузка ассетов и прогрев мозга).

| Функция | Описание |
| --- | --- |
| `pick(clientX, clientY)` | Что под курсором: `{ kind: 'fly' \| 'lid' \| 'glass', point }` (точка в мировых координатах) или `null` мимо банки. Муха выбирается, если луч проходит стекло и крышка не ближе. |
| обработчик `wheel` | На холсте: `window.widget.zoom(1,1^(−Δ/100))`, строки и страницы колеса пересчитываются в пиксели. |
| обработчик `visibilitychange` | Когда страница скрыта (окно перекрыто или свёрнуто), вызывает `sound.silence()`. |
| `shove(worldPoint, strength)` | Толчок банки в точке: наклон тем сильнее, чем выше точка, и закрутка от боковой точки. |
| `pokeFly(hit)`, `tapGlass(hit)` | Тычок в муху и стук по стеклу. |
| `pokedPart()` | Какая часть тела под лучом: `{ name, x }` (по узлам мухи; запасной вариант - `c_thorax`). |
| `updateThreat(dt)` | Превращает движение курсора в `fly.threat = { strength, side }` (быстрое сближение) и в вызовы `fly.seeObject(strength, side)` (движение мимо мухи). |
| `frame(now)` | Один кадр (см. [architecture](../architecture.md)); пропускается адаптивным ограничителем. |
| `render()` | Два прохода: муха в `innerRT`, затем сцена на экран. |

Отладочный объект `window.__w` (только с `?debug=1` или `--dev`/`--shot`): `THREE`, `jar`, `fly`, `link`, `motion`,
`sound`, `camera`, `scene`, `renderer`, `pick`, `frame`, `resize`.

## src/jar.js

| Экспорт | Описание |
| --- | --- |
| `JAR` | Размеры банки (радиус, стенка, плечо, горло, дно, крышка); таблица в [rendering](../rendering.md). |
| `outerRadiusAt(y)`, `innerRadiusAt(y)` | Внешний и внутренний радиус стекла на высоте `y`. |
| `createJar()` | Строит банку и возвращает объект ниже. |

Объект `createJar()`:

| Поле или метод | Описание |
| --- | --- |
| `root` | Группа наклона (pitch, roll) вокруг центра основания. |
| `spin` | Группа вращения вокруг оси; в ней стекло и крышка. |
| `inner` | Группа содержимого (муха): наклоняется с банкой, но не вращается. |
| `lid` | Группа крышки (для мыши и для проверки перекрытия). |
| `glassFront` | Внешняя ближняя оболочка стекла; цель луча для «под курсором банка». |
| `shadow` | Плоскость тени на «столе». |
| `setInnerTexture(texture)` | Текстура содержимого для преломления (`innerRT.texture`). |
| `setResolution(w, h)` | Размер буфера кадра для выборки из текстуры. |
| `glint(point)` | Вспышка блика в точке (мировые координаты). |
| `update(dt)` | Затухание блика. |

## src/env.js

| Экспорт | Описание |
| --- | --- |
| `studioEnvGLSL` | Строка GLSL с функцией `studioEnv(vec3 dir)` → линейный цвет; подставляется в шейдеры. |
| `createStudioEnvironment(renderer)` | Запекает «студию» в PMREM-текстуру для `scene.environment`. |

## src/flymodel.js

| Экспорт | Описание |
| --- | --- |
| `INNER_LAYER` | Слой мухи (1). |
| `MM` | Единиц банки на миллиметр настоящей мухи (0,17). |
| `BODY_H` | Высота центра груди над опорой в стойке (`groundMM × MM`, около 0,22). |
| `loadFlyAssets()` | Асинхронно читает `fly/flybody/rig.json` и `meshes.bin` через `window.widget.readAsset`; возвращает `{ rig, blob }`. |
| `buildFlyModel({ rig, blob })` | Собирает модель FlyBody, см. ниже. |
| `solveLeg(leg, target)` | Двухзвенное IK ноги в системе тела; записывает `leg.coxa.quaternion`, `leg.tibia.quaternion` и `leg.foot`. |

`buildFlyModel` возвращает `{ root, body, head, thorax, nodes, wings, halteres, legs, groom, setHead, bendAbdomen, setProboscis }`:

| Поле | Описание |
| --- | --- |
| `root`, `body` | Корень (позиция/ориентация мухи) и группа тела внутри него. |
| `head`, `thorax` | Узлы `c_head`, `c_thorax`. |
| `nodes` | Все 67 узлов по имени (`c_abdomen3`, `l_wing`, `lf_tibia`, …). |
| `wings[]` | `{ node, side, ghost, spread, fold }`: три копии на сторону (настоящее крыло и две «призрачные»); `spread` - поза покоя (развёрнуто), `fold` - поворот в сложенное положение. |
| `halteres[]` | `{ node, side, rest }`. |
| `legs[]` | По ноге: `side` (+1 левая), `idx` (0 передняя, 1 средняя, 2 задняя), `group` (0/1 для шагов треногой), `coxa`, `tibia`, `hip`, `a`, `b` (длины костей), `upperDir0`, `lowerDir0`, `coxaRest`, `femurRest`, `tibiaRestWorld` (поза покоя для IK), `home` (стопа в стойке), `tuck` (в полёте), `twitch` (смещение цели от мозга), `planted`, `stepFrom`, `stepTo`, `stepT`, `foot`. |
| `groom` | Точка перед головой, куда сходятся передние лапки при чистке (вычисляется по боксу головы). |
| `setHead(pitch, yaw)` | Наклон и поворот шеи, рад. |
| `bendAbdomen(total)` | Суммарный изгиб брюшка по шести суставам, рад (отрицательный - хвост вниз и вперёд). |
| `setProboscis(k)` | Хоботок: 0 сложен, 1 выдвинут. |

## src/fly.js

`class Fly` - сценарная муха и общая механика. Модуль также экспортирует `INNER_LAYER`, `rand(a, b)` и `randomUnit(out)`
(случайная величина и случайный единичный вектор; ими пользуется `BrainFly`).

```js
const fly = new Fly(await loadFlyAssets());
jar.inner.add(fly.object);
fly.update(dt, { gravity, shake });      // каждый кадр
```

| Член | Описание |
| --- | --- |
| `object` | `Group` в `jar.inner`: позиция и ориентация мухи. |
| `model` | Результат `buildFlyModel`. |
| `state` | `'fly'`, `'scared'`, `'approach'`, `'perch'`, `'tumble'`, `'dizzy'`. |
| `pos`, `vel`, `quat`, `heading` | Кинематика в координатах `jar.inner`. |
| `hitRadius` | Радиус сферы для клика (0,32). |
| `buzz`, `buzzSpeed` | Громкость и скорость для звука, 0-1. |
| `speed`, `activity` | Геттеры: скорость; 0 в покое, иначе больше 0 (для частоты кадров). |
| `update(dt, env)` | Шаг. `env = { gravity: Vector3 (в системе банки), shake: number }`. |
| `poke(dir)` | Тычок: кувырок с импульсом вдоль `dir` (у `BrainFly` - бросок в воздух, см. `launch`). |
| `startle(origin, radius = 1.2)` | Стук рядом с `origin`: муха срывается, если ближе `radius`. |
| `enterTumble(level)` | Начать кувырок от встряски. |
| `collide(restitution, clearance, yMin, yMax)` | Возвращает скорость, потерянную об стенку (0 - касания нет); держит муху в банке. |
| `bump(impact)` | Вызывает `onBump`, если удар сильнее 0,9. |
| `stickToSurface()` | Прижимает сидящую муху к полу или стенке. |
| `applyPose(dt)`, `poseWings(dt)`, `poseLegs(dt)` | Поза тела, крыльев и ног на кадр. |
| `holdAttitude(dt, target)` | Разворачивает тело к ориентации полёта `target`; `BrainFly` заменяет её свободным вращением. |
| `stepLead` | Упреждение шагающей стопы, единицы (0,03 вперёд; `BrainFly` ставит −0,03 при ходьбе назад). |
| `onBump(impact)`, `onLand()`, `onPoke()` | Коллбэки (звук). |
| `wingCommand` | `{ amp, fold }` или `null`: если задан, перебивает амплитуду и складывание крыльев (использует `BrainFly`). |

## src/brainfly.js

`class BrainFly extends Fly`. Использует `link` для обмена с мозгом; если `link.ready` ложно, ведёт себя как `Fly`.

| Экспорт | Описание |
| --- | --- |
| `BrainFly(assets, link)` | Конструктор; муха начинает на полу (`beginStand`). |
| `restingDrive()` | Токи покоящейся мухи (`{ группа: мВ }`), для прогрева мозга. |
| `touchGroups(part, localX)` | Группы касания по части тела и знаку x точки попадания. |

Члены `BrainFly`:

| Член | Описание |
| --- | --- |
| `threat` | `{ strength, side }`: приближающийся объект, выставляется приложением каждый кадр. |
| `seen` | `{ strength, side }`: малый движущийся объект (LC9, LC10d); заполняется `seeObject`, затухает с постоянной 0,25 с. |
| `walk`, `turn` | Сглаженные команды ходьбы вперёд/назад (−1…1) и поворота на опоре (−1 направо … 1 налево). |
| `groom`, `jump` | Сглаженная команда груминга (0…1, из DNg62 и DNge078) и мышца прыжка (0…1, из TTMn). |
| `dust` | Пыль на голове (0…1): держит щетинки `bm` под нагрузкой, пока груминг её не счистит; её оставляют касание головы и случайное событие. |
| `lift` | Подъёмная сила крыльев в весах: `clamp((power − 0,1)/0,4, 0, 1,15)` (геттер). |
| `gap`, `gapV` | Смещение и скорость стоящего тела от стекла, пока крылья и прыжок его отрывают (см. `pullOff`). |
| `nextAmbient` | Секунд до следующего редкого случайного воздействия (`1e9` отключает). |
| `events` | Очередь коротких сенсорных событий. |
| `power`, `steer`, `headYaw`, `headPitch`, `abdCurl`, `proboscis` | Сглаженные команды от мозга. |
| `useBrain` | `true`, если `link.ready`. |
| `addEvent(groups, mV, dur = 0.15)` | Короткое событие на группы. |
| `touch(part, localX, strength = 1)` | Касание части тела (12 мВ, 0,25 с); касание головы ещё оставляет пыль. |
| `seeObject(strength, side)` | Малый объект в поле зрения на стороне `side` (сила 0-1); его подают курсор (`updateThreat`) и случайные события. |
| `launch(vel, spin)` | Бросить тело в воздух со скоростью `vel` и вращением `spin` рад/с вокруг случайной оси (тычок, встряска). |
| `ambient(dt)` | Редкие случайные воздействия на сидящую муху (таблица `AMBIENT_EVENTS`). |
| `knock(strength = 1)` | Стук: вибрация на усики и гальтеры. |
| `beginStand(kind, where)` | Посадить муху на `'floor'` или `'wall'` в точке. |
| `update(dt, env)` | Кадр: `sense` → `read` → физика состояния → поза. |
| `sense(dt, env)`, `read(dt)` | Сбор токов и перевод частот пулов в команды. |
| `updateStand(dt, env)`, `walkOn(dt)`, `updateAir(dt, env)`, `crash(impact)` | Стояние, ходьба, полёт, удар о стекло; подробно в [brain_reference](../brain_reference.md). |
| `liftoff(n, up)` | Ускорение от поверхности с нормалью `n` (крылья и прыжок минус вес и хватка лапок); положительное - отрыв, отрицательное - посадка. |
| `pullOff(dt, env)`, `takeOff(speed)` | Отрыв стоящего тела от стекла с накопленной скоростью. Порога по мощности нет. |

## src/brainlink.js

`class BrainLink` - рендерерная сторона связи с мозгом.

| Член | Описание |
| --- | --- |
| `ready` | Мозг запущен и прогрет. |
| `sizes`, `neurons`, `connections`, `simMs` | Размеры групп, размер сети, число симулированных миллисекунд. |
| `await init(resting = {})` | Читает сведения, прогревает сеть 3 с токами `resting`; возвращает `false`, если мозга нет. |
| `update(drives, dtMs)` | Каждый кадр. Не блокирует: копит время и отправляет запрос, когда предыдущий завершён (не более 50 мс за раз). |
| `rate(name)` | Сглаженная частота группы, Гц на нейрон (постоянная 30 мс). |
| `both(prefix)` | Среднее по `prefix_L` и `prefix_R`. |
| `stop()` | Помечает мозг неготовым. |

## src/motion.js

`class JarMotion` - банка как целое.

| Член | Описание |
| --- | --- |
| `yaw`, `pitch`, `roll` (+ `…Vel`) | Углы и угловые скорости. Наклон - пружина (частота ~7,9 рад/с, затухание ~0,15), вращение свободное. |
| `shake` | Мера встряски: быстро растёт, медленно спадает; порог, с которого лапки мухи отрываются от стекла, - 1. |
| `grabbed` | Yaw ведёт указатель (скорость лишь запоминается для броска). |
| `kick(pitchVel, rollVel)` | Толчок пружин наклона. |
| `jerk(dvx, dvy)` | Рывок окна (изменение скорости в px/с): толкает наклон и копит энергию встряски. |
| `update(dt)` | Шаг физики. |

## src/audio.js

`class Sound` - весь звук синтезируется WebAudio.

| Член | Описание |
| --- | --- |
| `setEnabled(on)` | Включает или выключает звук (плавно), будит `AudioContext`. |
| `silence()` | Мгновенно гасит жужжание (страница скрыта, обновлять громкость некому); следующий `update()` вернёт звук. |
| `update({ buzz, speed, pan, depth })` | Раз в кадр: громкость (`buzz`), высота и яркость по `speed`, панорама `pan` (−1…1), лёгкий доплер по `depth` (+1 - к зрителю). |
| `ting(strength = 1)` | Звон стекла (стук по банке). |
| `tick(strength = 0.5)` | Сухой щелчок (муха ударилась о стекло). |
| `thud()` | Глухой удар (тычок). |
