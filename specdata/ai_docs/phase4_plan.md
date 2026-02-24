# План реализации Phase 4: Категории + Кастомный дашборд

## 1. SQL Миграция (supabase/migrations/20260224_phase4_categories.sql)

```sql
-- 1. Создание таблицы categories
CREATE TABLE public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('income', 'expense', 'salary')),
    is_default boolean NOT NULL DEFAULT false,
    color text,
    is_pinned_on_dashboard boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_workspace_id ON public.categories (workspace_id);

-- 2. Триггер updated_at
CREATE TRIGGER update_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 3. RLS для categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_select_policy"
    ON public.categories FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_id = categories.workspace_id
              AND wm.user_id = auth.uid()
              AND wm.is_active = true
        )
    );

CREATE POLICY "categories_insert_policy"
    ON public.categories FOR INSERT
    WITH CHECK (
        user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text])
    );

CREATE POLICY "categories_update_policy"
    ON public.categories FOR UPDATE
    USING (
        user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text])
    )
    WITH CHECK (
        user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text])
    );

CREATE POLICY "categories_delete_policy"
    ON public.categories FOR DELETE
    USING (
        user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text])
    );

-- 4. Добавление category_id в operations
ALTER TABLE public.operations
    ADD COLUMN category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE INDEX idx_operations_category_id ON public.operations(category_id);

-- 5. Функция для создания дефолтных категорий при создании workspace
CREATE OR REPLACE FUNCTION public.create_default_categories_for_workspace()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.categories (workspace_id, name, type, is_default, color, is_pinned_on_dashboard)
    VALUES
        (NEW.id, 'Зарплата', 'salary', true, '#3b82f6', true),
        (NEW.id, 'Продукты', 'expense', true, '#f97316', true),
        (NEW.id, 'Транспорт', 'expense', true, '#eab308', false),
        (NEW.id, 'Аренда', 'expense', true, '#ef4444', false),
        (NEW.id, 'Прочее', 'expense', true, '#6b7280', false),
        (NEW.id, 'Основной доход', 'income', true, '#22c55e', false);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Триггер вызова функции
CREATE TRIGGER on_workspace_created_categories
    AFTER INSERT ON public.workspaces
    FOR EACH ROW
    EXECUTE FUNCTION public.create_default_categories_for_workspace();

-- 7. (Опционально) Заполнить старые данные (миграция для уже созданных workspaces)
-- DO $$
-- DECLARE
--    ws RECORD;
-- BEGIN
--    FOR ws IN SELECT id FROM public.workspaces LOOP
--        INSERT INTO public.categories (workspace_id, name, type, is_default, color, is_pinned_on_dashboard)
--        VALUES
--            (ws.id, 'Зарплата', 'salary', true, '#3b82f6', true),
--            (ws.id, 'Продукты', 'expense', true, '#f97316', true),
--            (ws.id, 'Транспорт', 'expense', true, '#eab308', false),
--            (ws.id, 'Аренда', 'expense', true, '#ef4444', false),
--            (ws.id, 'Прочее', 'expense', true, '#6b7280', false),
--            (ws.id, 'Основной доход', 'income', true, '#22c55e', false);
--    END LOOP;
-- END $$;
```

## 2. Список компонентов/хуков для создания/изменения

### Новые
- **`src/hooks/useCategories.js`**: Хук для загрузки, создания, изменения и удаления категорий, а также для закрепления их на дашборде. Управление кешем и состоянием.
- **Вкладка "Категории"**: Можно реализовать как новый таб в `src/pages/WorkspaceSettingsPage.jsx` или как отдельную страницу `src/pages/CategoriesSettingsPage.jsx`. Интерфейс управления категориями (CRUD) и выбора "Дашборд пинов".

### Изменяемые
- **`src/pages/WorkspacePage.jsx` (Дашборд)**:
  - В блоке "Быстрые действия" вместо фиксированных кнопок загружать список закрепленных категорий текущего воркспейса (фильтр по `is_pinned_on_dashboard`).
  - Отрисовывать их кнопки на основе цвета и названия категории.
  - При клике передавать `category_id` и `type` в `AddOperationModal`.
- **`src/components/AddOperationModal.jsx`**:
  - Добавить загрузку категорий через `useCategories`.
  - Добавить `<select>` для выбора категории в форму.
  - Если передан конкретный `type` (например, открыта модалка расхода) — фильтровать категории в дропдауне по этому типу.
- **`src/pages/OperationPage.jsx`**:
  - В списке операций выводить название категории (вместо общих "Доход/Расход") и окрашивать значок в цвет категории.
  - Обновить форму добавления, чтобы можно было передать `category_id`.
  - Возможно, расширить текущий фильтр "По типу" фильтром "По категории".
- **`src/hooks/useOperations.js`**:
  - В `addOperation` принимать опциональный/обязательный `category_id` и сохранять в БД.
  - В SQL-запросе к таблице `operations` добавить JOIN с `categories` или делать отдельный запрос на фронте для сопоставления. Пример: `.select('..., categories(id, name, color)')`.

## 3. Детальный план реализации по шагам

**Шаг 1: БД и миграции**
1. Создать новую миграцию в `supabase/migrations/` (взяв за основу SQL из пункта 1).
2. Выполнить миграцию (`supabase db push` или через дашборд).
3. Убедиться, что скрипт на миграцию старых данных отработал, если в базе уже есть workspaces.

**Шаг 2: Создание логики категорий (useCategories)**
1. Реализовать `useCategories(workspaceId)` для инкапсуляции обращений к таблице `categories`.
2. Поддержать методы: `loadCategories`, `addCategory`, `updateCategory` (включая лимит пинов на 2 категории), `deleteCategory`.

**Шаг 3: Настройки категорий (UI)**
1. В `WorkspaceSettingsPage.jsx` добавить вкладку "Категории".
2. Вывести список категорий с группировкой по типам.
3. Реализовать форму добавления с color picker'ом.
4. Добавить чекбокс/иконку звездочки для пина на главную (валидация на клиенте: не больше 2 штук с `is_pinned_on_dashboard = true`).

**Шаг 4: Обновление модалки операции**
1. Открыть `AddOperationModal.jsx` и добавить dropdown категорий.
2. При смене типа операции (Доход/Расход) в форме — менять доступный список категорий в дропдауне.
3. Прокидывать `category_id` в вызов хука `useOperations -> addOperation`.

**Шаг 5: Обновление Дашборда (WorkspacePage)**
1. Заменить хардкодные кнопки в блоке "Быстрые действия".
2. Отрисовать до 2-х кнопок закрепленных категорий (например, "Зарплата" и "Аренда"). Добавить стандартную третью кнопку (или оставить как есть) для открытия модалки "Добавить любую операцию".

**Шаг 6: Обновление списка операций**
1. В `useOperations.js` расширить `.select('...')`, чтобы вытащить данные связанной категории (`category_id` -> название и цвет).
2. Отрендерить эти данные в компоненте списка в `OperationPage.jsx`.

## 4. Потенциальные сложности

1. **Миграция старых данных:** У существующих записей в `operations` поле `category_id` будет `null`. Интерфейс должен корректно переваривать `null` (показывать тип операции, как сейчас) либо потребуется миграционный скрипт, проставляющий категорию всем старым операциям в зависимости от их типа.
2. **Ограничение на 2 закрепленные категории:** Лучше всего проверять это на фронтенде в момент вызова `updateCategory`. Более строгий вариант (в БД) потребовал бы триггеров на проверку количества строк с `is_pinned_on_dashboard = true`, что может быть избыточным.
3. **Обновление кэша (React State):** При удалении категории, которая использовалась в операциях, срабатывает `ON DELETE SET NULL`. В UI (OperationPage) после удаления категории нужно или перефетчить список операций, или правильно обработать локальный state, чтобы операция не "сломалась".
4. **Форма добавления (связь Тип -> Категория):** Если пользователь сначала выбирает категорию, поле `type` в форме должно обновляться автоматически. Если он выбирает тип — список категорий в селекте должен отфильтроваться. Нужно аккуратно синхронизировать эти два поля.