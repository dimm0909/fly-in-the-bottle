# Быстрый старт

## Что понадобится

| Компонент | Зачем | Замечание |
| --- | --- | --- |
| Node.js и npm | Приложение (Electron 41, Three.js) | Проверено на Node 20.20 и npm 10.8. |
| Linux с X11 и композитным менеджером | Прозрачное окно и слой «на обоях» | Проверено на Ubuntu 24.04, GNOME 46, X11. Wayland не проверялся. |
| Python 3, `g++` (C++17), `make`, `curl` | Только для мозга | Проверено на Python 3.12 и g++ 13.3. |
| ~1,5 ГБ на диске | Только для мозга | 1,1 ГБ данные (из них 1,05 ГБ загрузка) + 57 МБ граф и таблица нейронов + окружение Python с `pyarrow` и `pandas`. |
| ~12 ГБ свободной RAM на минуту | Только для мозга, сборка графа | Пиковое потребление `tools/build_brain_graph.py`; сам мозг потом занимает около 90 МБ. |

Без мозга нужен только Node.js: виджет запустится на запасной сценарной мухе.

## Установка приложения

```bash
npm install
```

## Первый запуск

```bash
npm start
```

Скрипт выполняет `electron . --no-sandbox`. На Ubuntu 24.04 непривилегированные user namespaces
ограничены AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`), а `chrome-sandbox` из npm-пакета
не имеет прав setuid. Без флага окно на проверенной машине остаётся пустым и без единой ошибки в консоли.

Что вы увидите. Окно прозрачное и без рамки, по умолчанию оно стоит в правом нижнем углу основного
экрана и лежит **под всеми окнами** (тип окна `desktop`, на всех рабочих столах, не в панели задач и не в
Alt-Tab). Если рабочий стол закрыт окнами, банки не видно: покажите рабочий стол (`Super+D`) или
выберите в меню (правая кнопка) «Положение → Обычное окно» либо «Поверх всех окон».

Запущенный без мозга виджет живёт на сценарной мухе. Управление описано на странице
[controls](controls.md).

## Установка мозга

```bash
npm run brain:setup
```

Скрипт `tools/setup_brain.sh` делает за один проход:

1. скачивает три файла коннектомы MaleCNS v1.0 (Janelia FlyEM, CC-BY) с `storage.googleapis.com` в
   `data/malecns/`: связность (1,05 ГБ), аннотации (14 МБ), нейромедиаторы (43 МБ). Уже скачанные файлы
   пропускаются;
2. создаёт `.venv` (с доступом к системным пакетам) и ставит в него `pyarrow` и `pandas`;
3. `tools/build_brain_graph.py` строит граф `data/brain/graph.bin` и таблицу нейронов
   `data/brain/neurons.feather` (около 30 секунд);
4. `tools/build_groups.py` строит именованные группы нейронов `data/brain/groups.txt`;
5. `make -C brain` собирает симулятор `data/brain/brain`.

Каталог `data/` игнорируется git'ом. Если файл `data/brain/brain` на месте, следующий `npm start` сам
запустит мозг: в меню появится отмеченный пункт «Мозг: коннектом MaleCNS».

Первые 1–2 секунды после запуска окно пустое: мозг «прогревается» в состоянии покоя (иначе включение всех
сенсоров разом даёт залп, которого у настоящей мухи не бывает), и только потом появляется банка.

### Проверка мозга

```bash
npm run brain:check
```

Ожидаемый вывод (числа могут слегка отличаться):

```text
ok   graph loaded (164606 neurons, 6234901 connections)
ok   idle network is silent
ok   idle network is free (0.1 ms for 2 s)
ok   looming drives the flight muscles (dlm 152 dvm 79 Hz)
ok   looming fires the giant fibre (233 Hz)
ok   the response ends without input (dlm 0.0 Hz)
ok   abdomen touch reaches abdominal motor neurons (abd 20 Hz)
ok   abdomen touch is not a take-off (dlm 17 Hz)
ok   response grows with stimulus strength (dvm 81 < 100 < 113)
```

## Запуск без мозга

```bash
npm run start:scripted
```

Это `electron . --no-sandbox --no-brain`. Так же ведёт себя виджет, если `brain:setup` не выполнялся.

## Сборка документации

```bash
python3 -m venv --system-site-packages .venv   # если .venv ещё нет
.venv/bin/pip install -r docs/requirements.txt
make -C docs html
```

Или короче, когда окружение уже есть: `npm run docs`. Команда всегда делает полную пересборку
`docs/_build`, чтобы боковое меню и дерево страниц не расходились после правок `toctree`.
Готовый сайт лежит в `docs/_build/html/index.html`.

Без `make` то же самое делает `.venv/bin/sphinx-build -b html -E docs docs/_build/html`.

## Частые проблемы

| Симптом | Причина и решение |
| --- | --- |
| `TypeError: Cannot read properties of undefined (reading 'handle')` и в конце `Node.js v24…` | В окружении выставлен `ELECTRON_RUN_AS_NODE`, и Electron запустил `main.js` как обычный Node (так бывает в терминалах, запущенных из VS Code). Запускайте как `env -u ELECTRON_RUN_AS_NODE npm start`. |
| Окно пустое, банки нет, ошибок тоже нет | Запуск без `--no-sandbox` (см. выше). Используйте `npm start`, а не голый `electron .`. |
| Виджета не видно | Он под окнами. `Super+D` или меню → «Положение». |
| Окно непрозрачное, вместо фона чёрный прямоугольник | Вероятно, нет композитного менеджера окон. Не проверялось: на GNOME/X11 прозрачность работает из коробки. |
| В меню «Мозг: не установлен» | Не выполнен `npm run brain:setup` или не собран `data/brain/brain`. |
| `brain:setup` останавливается на сборке графа, в выводе `Killed` | Вероятно, не хватило RAM: сборка пиково занимает ~12 ГБ. Закройте тяжёлые приложения и повторите; уже скачанные файлы не скачиваются заново. |
| Нет звука | В меню отключён «Звук жужжания» либо выключен системный звук; звук синтезируется на лету, файлов нет. |
| Второй запуск ничего не делает | Разрешён один экземпляр: повторный запуск просто показывает уже запущенное окно. |

Более глубокие детали (флаги, слои, файл настроек, режим скриншотов): [launch_modes](launch_modes.md).
