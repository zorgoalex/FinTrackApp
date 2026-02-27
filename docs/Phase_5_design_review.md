# Phase 5 — Performance & Design Optimization

Результаты ревью frontend-design и vercel-react-best-practices.

---

## 1. Design Review (frontend-design skill)

**Средняя оценка текущего фронта: 2.8 / 10**

### 1.1 Typography (2/10)

**Проблема:** Используется Inter — самый generic sans-serif. Нет дифференциации display/body шрифтов. Суммы (главный элемент финприложения) слабо выделены (text-lg font-semibold). Текст text-[0.7rem] в тегах ниже порога читаемости на мобиле.

**Решение:**
- Заменить Inter на **Golos Text** (разработан для кириллицы, используется Госуслугами — доверие для МСБ аудитории РФ)
- Добавить **Unbounded** или **Syne** для крупных числовых значений сумм
- Типографическая шкала: суммы — min text-2xl с tabular-nums (font-feature-settings: "tnum"), заголовки — крупно с letter-spacing: -0.02em
- Минимальный кликабельный текст — text-sm, убрать text-[0.7rem]

**Файлы:** index.html (Google Fonts), tailwind.config.js (fontFamily), src/index.css

### 1.2 Color & Theme (2-3/10)

**Проблема:** 5-6 несвязанных цветовых пятен (blue-600, indigo, amber, green, red). primary используется как bg-blue-600 и bg-primary-600 в разных местах. Нет CSS variables. Фон bg-amber-50 для личного пространства почти неотличим от белого.

**Решение:**
- Ввести CSS custom properties: --color-income, --color-expense, --color-salary, --color-brand
- Консолидировать палитру до 3 ролей: brand (тёмно-индиго), semantic (income/expense/salary), surface (bg/border/text)
- Заменить sky-blue primary на авторитетный для финансов тёмно-индиго с акцентом teal (#0D9488) или amber (#D97706)
- Устранить прямое использование blue-600 где должен быть primary-600
- Убрать indigo как отдельный accent
- Усилить дифференциацию фона: личное — #FFF7ED (orange-50), корпоративное — #F8FAFC

**Файлы:** src/index.css (:root variables), tailwind.config.js (colors), все компоненты с hardcoded цветами

### 1.3 Motion & Animations (2/10)

**Проблема:** Модалки появляются без анимации. Аккордион summary открывается мгновенно (conditional render без CSS-перехода). Нет active-состояния кнопок. Нет визуального подтверждения сохранения (toast). FAB без press-эффекта.

**Решение:**
- Модалки: animate-in scale(0.95)→scale(1) за 150ms ease-out + backdrop fade
- Аккордион: max-height transition вместо conditional render
- Кнопки: active:scale-[0.97] transition-transform duration-100
- FAB: active:scale-90 transition-transform
- Toast/snackbar при успешном сохранении (slide-up 200ms)
- Skeleton-loader: staggered animation-delay 50ms на каждый элемент
- Кнопка "Сохранить" в loading: animated spinner вместо текста

**Файлы:** AddOperationModal.jsx, EditOperationModal.jsx, WorkspacePage.jsx (summary аккордеон), все кнопки

### 1.4 Spatial Composition (4/10)

**Проблема:** Разные max-w на страницах (max-w-2xl vs max-w-3xl). Touch-target кнопок ~36px (ниже рекомендованных 44px). Summary-карточки тесные (px-3 py-2.5).

**Решение:**
- Унифицировать max-w-2xl на всех страницах
- Touch-target всех кнопок: min-h-[44px] (WCAG + Apple HIG)
- Summary-карточки: min p-4
- Между блоками главной: space-y-5 или space-y-6 вместо space-y-4
- Единая сетка отступов: 4/8/12/16/24/32px

**Файлы:** WorkspacePage.jsx, OperationPage.jsx, все компоненты с кнопками

### 1.5 Backgrounds & Depth (3/10)

**Проблема:** Плоский дизайн без глубины. Карточки bg-white + shadow-sm + border — двойное визуальное ограничение. Sidebar белый на сером фоне. Modal overlay bg-black/40 стандартный.

**Решение:**
- Sidebar: bg-slate-900 с белым текстом (или брендовый тёмно-индиго) для depth
- Карточки: выбрать одно — shadow-md без border ИЛИ border без shadow
- Modal overlay: bg-black/50 backdrop-blur-sm
- Числовые значения: обернуть в цветные pill-бейджи bg-green-50 / bg-red-50
- Дифференциация фона: личное пространство — тёплый оттенок с subtle dot grid

**Файлы:** Layout.jsx (sidebar), все модалки, WorkspacePage.jsx

### 1.6 Иконография (2/10)

**Проблема:** Emoji (📊📈📝📌) используются как иконки в критических местах. На Android/корпоративных браузерах рендерятся по-разному. Смешаны с Lucide-иконками.

**Решение:**
- Заменить ВСЕ emoji на Lucide-иконки (библиотека уже подключена):
  - 📊 → TrendingUp или BarChart3
  - 📈 → TrendingUp
  - 📝 → FileText
  - 📌 → Pin
- Единый стиль иконографии на всех экранах

**Файлы:** WorkspacePage.jsx, OperationPage.jsx

---

## 2. React Performance Review (vercel-react-best-practices)

### 2.1 CRITICAL — Eliminating Waterfalls

| # | Файл:строка | Проблема | Решение |
|---|-------------|----------|---------|
| 1 | useOperations.js:121-128 | getAuthUser() последовательно до запроса operations (+100-200ms) | Promise.all([getAuthUser(), supabase.from('operations')...]) |
| 2 | useOperations.js:138-174 | 3 sequential запроса: operations → operation_tags → tags | tags не зависит от operation_tags — запустить параллельно; рассмотреть Supabase nested select |
| 3 | useOperations.js:250-278 | addOperation: for...of loop для тегов — N*2 sequential round-trips | Promise.all для параллельного lookup + batch INSERT |
| 4 | useOperations.js:336-368 | updateOperation: та же sequential проблема для тегов | Аналогично — Promise.all + batch insert |
| 5 | WorkspaceContext.jsx:184-191 | Sequential await для loadWorkspaceMembers + loadPendingInvitations | Promise.all; updateLastAccessed — fire-and-forget без await |
| 6 | OperationPage.jsx:127-148 | loadEmails: Promise.all для RPC вызовов при каждом изменении monthlyOperations | Кешировать email через useRef, не перезапрашивать известные ID |

### 2.2 CRITICAL — Bundle Size

| # | Файл | Проблема | Решение |
|---|------|----------|---------|
| 7 | App.jsx:1-16 | Все страницы — static imports, нет code splitting | React.lazy() + Suspense для каждой страницы |
| 8 | vite.config.js | Нет manualChunks, весь vendor в одном чанке | Добавить rollupOptions.output.manualChunks: vendor-react, vendor-supabase, vendor-ui |
| 9 | lucide-react@0.263.1 | Старая версия без полного tree-shaking | Обновить до 0.400+ или импорт из конкретных путей |
| 10 | package.json | date-fns@2.30.0 подключён, но в коде используется new Date() вручную | Проверить реальное использование; если 1-2 места — заменить на Intl.DateTimeFormat |

### 2.3 HIGH — Data Fetching & Caching

| # | Файл:строка | Проблема | Решение |
|---|-------------|----------|---------|
| 11 | AddOperationModal.jsx:29-30 | Дублирующие useCategories/useTags при каждом открытии модала | Поднять данные на уровень родителя, передавать как props |
| 12 | useOperations.js (add/update/delete) | Полный loadOperations() после каждой мутации | Optimistic update: обновить state сразу, откатить при ошибке |
| 13 | WorkspaceContext.jsx:54-133 | loadAllWorkspaces при каждом изменении userId/workspaceId, нет кеша | sessionStorage с TTL; инвалидировать при мутациях |

### 2.4 MEDIUM — Re-render Optimization

| # | Файл:строка | Проблема | Решение |
|---|-------------|----------|---------|
| 14 | WorkspaceContext.jsx:507-539 | value объект без useMemo — ре-рендер всех consumers | useMemo для value; разделить на DataContext + ActionsContext |
| 15 | OperationPage.jsx:207-216 | handleDoubleTap useCallback с нестабильными deps [permissions, user] | useRef для permissions внутри callback |
| 16 | OperationPage.jsx:65-78 | 10+ useState в одном компоненте для фильтров/сортировки | Сгруппировать в useReducer: filterState = {type, category, tags, sort, dir} |
| 17 | useOperations.js:422-424 | calculateSummary в useEffect+setState вместо useMemo | Заменить на useMemo — убирает лишний ре-рендер |

### 2.5 MEDIUM — Rendering & JS Performance

| # | Файл:строка | Проблема | Решение |
|---|-------------|----------|---------|
| 18 | OperationPage.jsx:558-560 | categories.find() в render loop — O(n*m) | Предвычислить Map через useMemo |
| 19 | OperationPage.jsx:481 | viewMode проверяется внутри .map() для каждого элемента | Вынести ветвление на уровень выше map |
| 20 | client-localstorage | localStorage без валидации и schema versioning | Создать storageService с типизированными ключами и fallback |

---

## 3. Порядок выполнения Phase 5

### Этап 5.1: Performance Critical Fixes (~4-6ч)
- Параллелизация запросов в useOperations (Promise.all)
- Code splitting (React.lazy + Suspense) в App.jsx
- manualChunks в vite.config.js
- Promise.all в WorkspaceContext

### Этап 5.2: Performance High Fixes (~3-4ч)
- Убрать дублирующие fetch в модалках (props вместо хуков)
- Optimistic updates в useOperations
- useMemo для WorkspaceContext value

### Этап 5.3: Design — Typography & Color (~3-4ч)
- Замена Inter на Golos Text + числовой шрифт
- CSS custom properties для цветовой системы
- Консолидация палитры

### Этап 5.4: Design — Motion & Depth (~3-4ч)
- Анимации модалок (scale+fade)
- Анимация аккордеонов (max-height transition)
- Тёмный sidebar
- Toast/snackbar для обратной связи

### Этап 5.5: Design — Polish (~2-3ч)
- Замена emoji на Lucide-иконки
- Touch-target 44px
- Унификация отступов и max-w
- active-состояния кнопок

### Этап 5.6: Performance Medium Fixes (~2-3ч)
- useReducer для фильтров OperationPage
- categoryMap через useMemo
- calculateSummary → useMemo
- storageService

---

## 4. Итого Phase 5: ~17-24 часа

| Этап | Сложность | Приоритет |
|------|-----------|-----------|
| 5.1 Performance Critical | Средняя | MUST |
| 5.2 Performance High | Средняя | MUST |
| 5.3 Design Typography & Color | Средняя | SHOULD |
| 5.4 Design Motion & Depth | Средняя | SHOULD |
| 5.5 Design Polish | Низкая | NICE-TO-HAVE |
| 5.6 Performance Medium | Низкая | NICE-TO-HAVE |
