# План реализации Фазы 4: Категории и Теги

Этот документ описывает детальный план реализации для Фазы 4, основанный на [исследовательском документе](./phase4_research.md).

## 1. Решения по открытым вопросам

1.  **Привязка категории к типу операции**: **Да.** Список доступных категорий в выпадающем меню будет автоматически фильтроваться в зависимости от выбранного типа операции («Доход» или «Расход»).
2.  **Рефакторинг модального окна на `OperationPage`**: **Да.** Страница `OperationPage` будет отрефакторена для использования общего компонента `AddOperationModal` вместо встроенной формы. Это устранит дублирование кода и обеспечит консистентность UI.
3.  **Логика фильтрации по тегам**: **"ИЛИ" (OR).** При выборе нескольких тегов в фильтре будут показаны операции, у которых есть *хотя бы один* из выбранных тегов.
4.  **UI фильтра по категориям**: **Выпадающий список (Dropdown).** Этот элемент лучше масштабируется для потенциально длинного списка категорий, создаваемых пользователем.
5.  **Цвета тегов**: **Опционально, с цветом по умолчанию.** При создании нового тега ему будет присваиваться цвет из предопределенной палитры. Пользовательский интерфейс для выбора цвета в Фазе 4 создаваться не будет.
6.  **Отображение тегов в списке операций**: **Отображать как чипы.** Если у операции более 3 тегов, будут показаны первые 2, а затем индикатор "+N еще" (например, "+2 еще").
7.  **Отображение на главной панели (Dashboard)**: **Нет.** Чтобы сохранить чистоту и минимализм интерфейса, теги и категории не будут отображаться в списке последних операций на главной странице.
8.  **Управление категориями и тегами**: **Только встроенное создание.** В Фазе 4 не будет отдельной страницы для управления. Категории и теги будут создаваться "на лету" через модальное окно добавления операции.
9.  **Тестирование**: Основное внимание будет уделено юнит- и интеграционным тестам для новых хуков и компонентов.

## 2. Затрагиваемые файлы

### Новые файлы:
- `supabase/migrations/YYYYMMDD_phase4_tags_and_categories.sql`
- `src/hooks/useCategories.js`
- `src/hooks/useTags.js`
- `src/components/TagInput.jsx`
- `src/components/TagInput.test.jsx` (или аналогичный)

### Файлы для модификации:
- `src/hooks/useOperations.js`
- `src/components/AddOperationModal.jsx`
- `src/pages/OperationPage.jsx`
- `src/pages/WorkspacePage.jsx`

---

## 3. SQL миграция

Будет создан один файл миграции `supabase/migrations/YYYYMMDD_phase4_tags_and_categories.sql`.

```sql
-- Таблица для категорий
CREATE TABLE public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('income', 'expense')), -- 'salary' не имеет категорий
    color text, -- опционально
    created_at timestamz NOT NULL DEFAULT now(),
    updated_at timestamz NOT NULL DEFAULT now()
);

-- Индексы для категорий
CREATE INDEX idx_categories_workspace_id ON public.categories(workspace_id);
CREATE UNIQUE INDEX idx_categories_workspace_id_name_type ON public.categories(workspace_id, name, type);

-- Таблица для тегов
CREATE TABLE public.tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    name text NOT NULL,
    color text, -- опционально
    created_at timestamz NOT NULL DEFAULT now(),
    updated_at timestamz NOT NULL DEFAULT now()
);

-- Индексы для тегов
CREATE INDEX idx_tags_workspace_id ON public.tags(workspace_id);
CREATE UNIQUE INDEX idx_tags_workspace_id_name ON public.tags(workspace_id, name);

-- Связующая таблица для операций и тегов (многие-ко-многим)
CREATE TABLE public.operation_tags (
    operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (operation_id, tag_id)
);

-- Добавление внешнего ключа для категории в таблицу операций
ALTER TABLE public.operations
ADD COLUMN category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE INDEX idx_operations_category_id ON public.operations(category_id);

-- Политики безопасности (RLS)

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow members to view categories" ON public.categories
FOR SELECT USING (is_member_of_workspace(workspace_id));

CREATE POLICY "Allow members to insert categories" ON public.categories
FOR INSERT WITH CHECK (is_member_of_workspace(workspace_id));

CREATE POLICY "Allow admins to update/delete categories" ON public.categories
FOR ALL USING (is_admin_of_workspace(workspace_id));

CREATE POLICY "Allow members to view tags" ON public.tags
FOR SELECT USING (is_member_of_workspace(workspace_id));

CREATE POLICY "Allow members to insert tags" ON public.tags
FOR INSERT WITH CHECK (is_member_of_workspace(workspace_id));

CREATE POLICY "Allow admins to update/delete tags" ON public.tags
FOR ALL USING (is_admin_of_workspace(workspace_id));

CREATE POLICY "Allow members to view links" ON public.operation_tags
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.operations
    WHERE id = operation_id AND is_member_of_workspace(workspace_id)
  )
);

CREATE POLICY "Allow members to link tags" ON public.operation_tags
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.operations
    WHERE id = operation_id AND is_member_of_workspace(workspace_id)
  )
);

CREATE POLICY "Allow members to unlink tags" ON public.operation_tags
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.operations
    WHERE id = operation_id AND is_member_of_workspace(workspace_id)
  )
);
```

---

## 4. Пошаговый план реализации

### **Этап 1: Миграция базы данных**

1.  **Задача**: Создать новый файл миграции.
    - **Файл**: `supabase/migrations/<timestamp>_phase4_tags_and_categories.sql`
    - **Что делать**: Скопировать и вставить SQL-код из раздела 3 в этот файл.
    - **Результат**: Новые таблицы и политики готовы к использованию после применения миграции.

### **Этап 2: Создание и обновление хуков**

2.  **Задача**: Создать хук `useCategories`.
    - **Файл**: `src/hooks/useCategories.js` (новый)
    - **Что делать**: Реализовать хук, который загружает все категории для данного `workspaceId`. Он должен возвращать `categories`, `loading`, `error` и функцию `addCategory`.
    - **Результат**: Хук для получения и создания категорий в рамках рабочего пространства.

3.  **Задача**: Создать хук `useTags`.
    - **Файл**: `src/hooks/useTags.js` (новый)
    - **Что делать**: Реализовать хук для загрузки тегов. Он должен включать функцию `findOrCreateTag(name)`, которая находит тег по имени или создает новый, если он не существует.
    - **Результат**: Хук для получения и создания тегов.

4.  **Задача**: Обновить хук `useOperations`.
    - **Файл**: `src/hooks/useOperations.js`
    - **Что делать**:
        - В `loadOperations` добавить `category_id` и `categories(name, color)` в `.select()`. Также реализовать загрузку тегов для каждой операции (через `operation_tags` и `tags`).
        - В `addOperation` добавить обработку `category_id` и `tags`. Логика должна:
            1. Создать/найти ID для всех тегов.
            2. Вставить операцию с `category_id`.
            3. Вставить записи в `operation_tags`.
    - **Результат**: Хук `useOperations` управляет полным циклом создания операции, включая категории и теги.

### **Этап 3: Компонент `TagInput`**

5.  **Задача**: Создать компонент `TagInput`.
    - **Файл**: `src/components/TagInput.jsx` (новый)
    - **Что делать**: Разработать компонент, который позволяет вводить текст, показывает список подходящих тегов (автодополнение) и отображает выбранные теги в виде чипов. Должна быть возможность создавать новый тег, если его нет в списке.
    - **Результат**: Переиспользуемый компонент для выбора и создания тегов.

6.  **Задача**: Написать тесты для `TagInput`.
    - **Файл**: `src/components/TagInput.test.jsx` (новый)
    - **Что делать**: Написать базовые юнит-тесты для проверки рендеринга, выбора и добавления тегов.
    - **Результат**: Проверенная работоспособность компонента `TagInput`.

### **Этап 4: Обновление `AddOperationModal`**

7.  **Задача**: Модифицировать `AddOperationModal`.
    - **Файл**: `src/components/AddOperationModal.jsx`
    - **Что делать**:
        - Добавить пропс `workspaceId`.
        - Внутри компонента использовать хуки `useCategories` и `useTags`.
        - Добавить выпадающий список для категорий. Список должен фильтроваться по `form.type`.
        - Интегрировать компонент `TagInput`.
        - Обновить `onSave`, чтобы он передавал `category_id` и массив тегов.
    - **Результат**: `AddOperationModal` полностью готов к созданию операций с категориями и тегами.

### **Этап 5: Обновление `OperationPage`**

8.  **Задача**: Рефакторинг `OperationPage` для использования `AddOperationModal`.
    - **Файл**: `src/pages/OperationPage.jsx`
    - **Что делать**: Удалить встроенную форму модального окна и заменить её вызовом `<AddOperationModal>`. Передать ему `workspaceId` и другие необходимые пропсы.
    - **Результат**: Устранено дублирование кода, страница использует общий компонент.

9.  **Задача**: Добавить UI для фильтров.
    - **Файл**: `src/pages/OperationPage.jsx`
    - **Что делать**: Добавить выпадающий список для фильтрации по категории и компонент, похожий на `TagInput`, для фильтрации по тегам.
    - **Результат**: Пользователь может выбирать категорию и теги для фильтрации списка операций.

10. **Задача**: Реализовать логику фильтрации.
    - **Файл**: `src/pages/OperationPage.jsx`
    - **Что делать**: Обновить `useMemo` для `visibleOperations`, добавив фильтрацию по `filterCategory` и `filterTags` (с логикой "ИЛИ" для тегов).
    - **Результат**: Список операций динамически обновляется при изменении фильтров.

11. **Задача**: Отобразить категории и теги в списке операций.
    - **Файл**: `src/pages/OperationPage.jsx`
    - **Что делать**:
        - В строке операции отобразить название категории.
        - Отобразить теги в виде чипов, реализуя логику "первые 2 + N еще" при количестве тегов > 3.
    - **Результат**: Пользователь видит полную информацию по каждой операции.

### **Этап 6: Обновление `WorkspacePage` и тесты**

12. **Задача**: Обновить вызов `AddOperationModal` на `WorkspacePage`.
    - **Файл**: `src/pages/WorkspacePage.jsx`
    - **Что делать**: При вызове `AddOperationModal` передать в него `workspaceId`.
    - **Результат**: Модальное окно, вызываемое с главной страницы, также поддерживает категории и теги.

13. **Задача**: Написать тесты для новых хуков.
    - **Файл**: `src/hooks/useCategories.test.js`, `src/hooks/useTags.test.js`
    - **Что делать**: Написать юнит-тесты, мокая вызовы Supabase, для проверки логики загрузки и создания сущностей.
    - **Результат**: Хуки `useCategories` и `useTags` покрыты тестами.
