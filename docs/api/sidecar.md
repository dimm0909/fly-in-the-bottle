# Сайдкар мозга (C++)

Каталог `brain/`. Собирается командой `npm run brain:compile` (`tools/dev.js compile-brain`) в `data/brain/brain`
(на Windows `brain.exe`): по очереди пробуются `g++`, `c++`, `clang++` (`-O3 -ffast-math -std=c++17`, на Linux и с
`-march=native`, на Windows со `-static`), на Windows затем MSVC (`cl /O2 /fp:fast /MT`), а если компилятора нет -
`ziglang` из PyPI. На Linux работает и `make -C brain`. Код не привязан к платформе: только стандартная библиотека
C++17 и `stdio`. Текстовый протокол описан в [brain_reference](../brain_reference.md); модель и внутреннее
устройство - в [brain_model](../brain_model.md).

## brain.h

### `Params`

Параметры модели; значения по умолчанию - откалиброванные ([brain_model](../brain_model.md)).

| Поле | По умолчанию | Единицы | Смысл |
| --- | --- | --- | --- |
| `dt` | 1,0 | мс | Шаг. |
| `tau_m` | 20 | мс | Постоянная мембраны. |
| `tau_syn` | 5 | мс | Постоянная синаптического тока. |
| `threshold` | 7 | мВ | Порог над покоем. |
| `w_syn` | 0,15 | мВ | Вес одного синапса. |
| `w_ext` | 1,5 | мВ | Вес внешнего пуассоновского события. |
| `delay` | 2 | мс | Синаптическая задержка. |
| `refractory` | 2 | мс | Абсолютная рефрактерность. |
| `adapt` | 0,10 | мВ | Добавка к порогу за спайк. |
| `tau_adapt` | 1500 | мс | Время возврата порога. |

### `Graph`

CSR по пресинаптическому нейрону: `n` (нейронов), `e` (связей), `row_ptr[n+1]`, `col[e]` (постсинаптический
нейрон), `w[e]` (знаковое число синапсов).

### `Group`

`{ std::string name; std::vector<uint32_t> neurons; }`.

### Функции загрузки

| Функция | Описание |
| --- | --- |
| `bool load_graph(path, Graph&, std::string& err)` | Читает `graph.bin` (формат ниже). |
| `bool load_groups(path, n, std::vector<Group>&, std::string& err)` | Читает `groups.txt`, проверяет, что индексы меньше `n`. |
| `std::unique_ptr<Backend> make_cpu_backend(graph, params, groups)` | Создаёт событийный CPU-бэкенд. |

### `Backend`

Абстрактный интерфейс. CUDA-бэкенд, если он понадобится, реализует его же (заготовка `#ifdef WITH_CUDA` есть в
`brain.h` и `main.cpp`, но самого бэкенда нет).

| Метод | Описание |
| --- | --- |
| `name()` | Имя бэкенда (`"cpu"`). |
| `set_drive(neurons, value)` | Постоянный ток в мВ; `0` снимает. |
| `set_poisson(neurons, rate_hz)` | Пуассоновский вход; `0` снимает. |
| `clear_inputs()` | Снять всё. |
| `cut_outputs(neurons)` | Обнулить исходящие связи. |
| `reset()` | Обнулить состояние. |
| `set_params(params)` | Сменить параметры (пересчёт таблиц). |
| `advance(steps)` | Выполнить `steps` шагов. |
| `take_counts(counts)` | Забрать счётчики спайков групп и обнулить их. |
| `take_spikes(ids)` | Нейроны, спайкнувшие за последний `advance` (до 4096). |
| `total_spikes()` | Спайков с начала работы. |

`CpuBackend` (в `cpu.cpp`) - единственная реализация: активный список нейронов, кольцо задержек, колесо
времени для пуассоновского входа.

## Форматы файлов

### `data/brain/graph.bin`

Little-endian.

| Смещение | Тип | Содержимое |
| --- | --- | --- |
| 0 | `char[4]` | `FBRN` |
| 4 | `uint32` | версия (1) |
| 8 | `uint32` | число нейронов `N` |
| 12 | `uint64` | число связей `E` |
| 20 | `uint32[N+1]` | `row_ptr` |
| … | `uint32[E]` | `col` |
| … | `float32[E]` | `w` |

Заголовок упакован (без выравнивания): в `cpu.cpp` это структура `GraphHeader` под `#pragma pack(push, 1)` с
`static_assert(sizeof(GraphHeader) == 20)`, поэтому размер и раскладка не зависят от компилятора (GCC, Clang, MSVC).
Файл читается в бинарном режиме (`fopen(…, "rb")`). Пишет `tools/build_brain_graph.py`.

### `data/brain/groups.txt`

Одна группа на строку: `имя<TAB>индекс,индекс,…`. Индексы - номера нейронов в порядке графа (то же, что строки
`neurons.feather`). Строки, начинающиеся с `#`, и пустые пропускаются. Порядок групп в файле определяет
порядок счётчиков в ответе `advance`.

### `data/brain/neurons.feather`

Таблица нейронов в порядке графа. Колонки: `bodyId`, `superclass`, `class`, `subclass`, `type`, `instance`,
`somaSide`, `nt` (нейромедиатор), `sign`, `entryNerve`, `exitNerve`, `flywireType`, `receptorType`. По ней строятся
группы и с ней сопоставляются индексы из ответа `spikes`.
