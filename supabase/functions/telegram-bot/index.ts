import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Telegram API helpers ---

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
}

// --- DB helpers ---

async function getTelegramUser(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('telegram_users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();
  return data;
}

async function getUserWorkspaces(userId: string) {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id, role, workspaces(id, name, is_personal)')
    .eq('user_id', userId)
    .eq('is_active', true);
  return data || [];
}

async function getOperationsSummary(
  workspaceId: string,
  dateFrom: string,
  dateTo: string,
) {
  const { data } = await supabaseAdmin
    .from('operations')
    .select('amount, type')
    .eq('workspace_id', workspaceId)
    .gte('operation_date', dateFrom)
    .lte('operation_date', dateTo);

  let income = 0;
  let expense = 0;
  for (const op of data || []) {
    if (op.type === 'income' || op.type === 'salary') {
      income += Number(op.amount);
    } else {
      expense += Number(op.amount);
    }
  }
  return { income, expense, balance: income - expense };
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEndStr() {
  const d = new Date();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function formatMoney(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- Command Handlers ---

async function handleStart(chatId: number) {
  await sendMessage(
    chatId,
    `<b>FinTrackApp Bot</b>\n\n` +
      `Команды:\n` +
      `/link email password — привязать аккаунт\n` +
      `/unlink — отвязать аккаунт\n` +
      `/workspaces — список пространств\n` +
      `/ws номер — выбрать пространство\n` +
      `/balance — баланс за месяц\n` +
      `/today — сводка за сегодня\n` +
      `/month — сводка за месяц\n` +
      `/add сумма описание — добавить расход\n` +
      `/income сумма описание — добавить доход\n` +
      `/categories — список категорий\n` +
      `/addcat тип название [цвет] — создать категорию\n` +
      `/tags — список тегов\n` +
      `/addtag название [цвет] — создать тег\n` +
      `/recent — последние 10 операций`,
  );
}

async function handleLink(chatId: number, telegramId: number, args: string[]) {
  if (args.length < 2) {
    return await sendMessage(chatId, 'Использование: /link email password');
  }

  const [email, password] = args;

  // Check if already linked
  const existing = await getTelegramUser(telegramId);
  if (existing) {
    return await sendMessage(chatId, 'Аккаунт уже привязан. Используйте /unlink чтобы отвязать.');
  }

  // Sign in to verify credentials
  const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return await sendMessage(chatId, `Ошибка входа: ${authError?.message || 'неверные данные'}`);
  }

  // Save link
  const { error: insertError } = await supabaseAdmin
    .from('telegram_users')
    .insert({
      telegram_id: telegramId,
      user_id: authData.user.id,
    });

  if (insertError) {
    return await sendMessage(chatId, `Ошибка привязки: ${insertError.message}`);
  }

  // Set default workspace to first available
  const workspaces = await getUserWorkspaces(authData.user.id);
  if (workspaces.length > 0) {
    await supabaseAdmin
      .from('telegram_users')
      .update({ default_workspace_id: workspaces[0].workspace_id })
      .eq('telegram_id', telegramId);
  }

  await sendMessage(
    chatId,
    `Аккаунт привязан: ${authData.user.email}\n` +
      (workspaces.length > 0
        ? `Пространство по умолчанию: ${(workspaces[0] as any).workspaces?.name || workspaces[0].workspace_id}`
        : 'Нет доступных пространств.'),
  );
}

async function handleUnlink(chatId: number, telegramId: number) {
  const { error } = await supabaseAdmin
    .from('telegram_users')
    .delete()
    .eq('telegram_id', telegramId);

  if (error) {
    return await sendMessage(chatId, `Ошибка: ${error.message}`);
  }
  await sendMessage(chatId, 'Аккаунт отвязан.');
}

async function handleWorkspaces(chatId: number, userId: string) {
  const workspaces = await getUserWorkspaces(userId);
  if (workspaces.length === 0) {
    return await sendMessage(chatId, 'Нет доступных пространств.');
  }

  const lines = workspaces.map(
    (w: any, i: number) => `${i + 1}. ${w.workspaces?.name || w.workspace_id} (${w.role})`,
  );
  await sendMessage(chatId, `<b>Пространства:</b>\n${lines.join('\n')}\n\nИспользуйте /ws номер для выбора.`);
}

async function handleSelectWorkspace(chatId: number, telegramId: number, userId: string, args: string[]) {
  const num = parseInt(args[0], 10);
  if (!num || num < 1) {
    return await sendMessage(chatId, 'Использование: /ws номер');
  }

  const workspaces = await getUserWorkspaces(userId);
  if (num > workspaces.length) {
    return await sendMessage(chatId, `Нет пространства с номером ${num}. Всего: ${workspaces.length}`);
  }

  const selected = workspaces[num - 1];
  await supabaseAdmin
    .from('telegram_users')
    .update({ default_workspace_id: selected.workspace_id })
    .eq('telegram_id', telegramId);

  await sendMessage(chatId, `Выбрано: ${(selected as any).workspaces?.name || selected.workspace_id}`);
}

async function handleBalance(chatId: number, workspaceId: string) {
  const summary = await getOperationsSummary(workspaceId, monthStartStr(), monthEndStr());
  await sendMessage(
    chatId,
    `<b>Баланс за месяц:</b>\n` +
      `Доходы: ${formatMoney(summary.income)}\n` +
      `Расходы: ${formatMoney(summary.expense)}\n` +
      `Баланс: ${formatMoney(summary.balance)}`,
  );
}

async function handleToday(chatId: number, workspaceId: string) {
  const today = todayStr();
  const summary = await getOperationsSummary(workspaceId, today, today);
  await sendMessage(
    chatId,
    `<b>Сегодня (${today}):</b>\n` +
      `Доходы: ${formatMoney(summary.income)}\n` +
      `Расходы: ${formatMoney(summary.expense)}\n` +
      `Баланс: ${formatMoney(summary.balance)}`,
  );
}

async function handleMonth(chatId: number, workspaceId: string) {
  await handleBalance(chatId, workspaceId);
}

async function handleAdd(
  chatId: number,
  userId: string,
  workspaceId: string,
  type: 'income' | 'expense',
  args: string[],
) {
  if (args.length < 1) {
    return await sendMessage(chatId, `Использование: /${type === 'expense' ? 'add' : 'income'} сумма [описание]`);
  }

  const amount = parseFloat(args[0].replace(',', '.'));
  if (isNaN(amount) || amount <= 0) {
    return await sendMessage(chatId, 'Некорректная сумма.');
  }

  const description = args.slice(1).join(' ') || null;

  const { data, error } = await supabaseAdmin
    .from('operations')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      amount,
      type,
      description,
      operation_date: todayStr(),
    })
    .select()
    .single();

  if (error) {
    return await sendMessage(chatId, `Ошибка: ${error.message}`);
  }

  const label = type === 'income' ? 'Доход' : 'Расход';
  await sendMessage(
    chatId,
    `${label} добавлен: ${formatMoney(amount)}${description ? ` — ${description}` : ''}`,
  );
}

async function handleCategories(chatId: number, workspaceId: string) {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('id, name, type, color, is_archived')
    .eq('workspace_id', workspaceId)
    .eq('is_archived', false)
    .order('type')
    .order('name');

  if (error) return await sendMessage(chatId, `Ошибка: ${error.message}`);
  if (!data || data.length === 0) return await sendMessage(chatId, 'Нет категорий.');

  const lines = data.map((c: any) => `• ${c.name} (${c.type}) ${c.color}`);
  await sendMessage(chatId, `<b>Категории:</b>\n${lines.join('\n')}`);
}

async function handleAddCategory(
  chatId: number,
  userId: string,
  workspaceId: string,
  args: string[],
) {
  if (args.length < 2) {
    return await sendMessage(chatId, 'Использование: /addcat тип название [цвет]\nТип: income или expense');
  }

  const type = args[0].toLowerCase();
  if (type !== 'income' && type !== 'expense') {
    return await sendMessage(chatId, 'Тип должен быть income или expense');
  }

  const name = args[1];
  const color = args[2] || '#6B7280';

  const { data, error } = await supabaseAdmin
    .from('categories')
    .insert({ workspace_id: workspaceId, name, type, color })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return await sendMessage(chatId, 'Категория уже существует.');
    return await sendMessage(chatId, `Ошибка: ${error.message}`);
  }

  await sendMessage(chatId, `Категория создана: ${data.name} (${data.type})`);
}

async function handleTags(chatId: number, workspaceId: string) {
  const { data, error } = await supabaseAdmin
    .from('tags')
    .select('id, name, color, is_archived')
    .eq('workspace_id', workspaceId)
    .eq('is_archived', false)
    .order('name');

  if (error) return await sendMessage(chatId, `Ошибка: ${error.message}`);
  if (!data || data.length === 0) return await sendMessage(chatId, 'Нет тегов.');

  const lines = data.map((t: any) => `• ${t.name} ${t.color}`);
  await sendMessage(chatId, `<b>Теги:</b>\n${lines.join('\n')}`);
}

async function handleAddTag(
  chatId: number,
  userId: string,
  workspaceId: string,
  args: string[],
) {
  if (args.length < 1) {
    return await sendMessage(chatId, 'Использование: /addtag название [цвет]');
  }

  const name = args[0];
  const color = args[1] || '#6B7280';

  const { data, error } = await supabaseAdmin
    .from('tags')
    .insert({ workspace_id: workspaceId, name, color })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return await sendMessage(chatId, 'Тег уже существует.');
    return await sendMessage(chatId, `Ошибка: ${error.message}`);
  }

  await sendMessage(chatId, `Тег создан: ${data.name}`);
}

async function handleRecent(chatId: number, workspaceId: string) {
  const { data, error } = await supabaseAdmin
    .from('operations')
    .select('amount, type, description, operation_date')
    .eq('workspace_id', workspaceId)
    .order('operation_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return await sendMessage(chatId, `Ошибка: ${error.message}`);
  if (!data || data.length === 0) return await sendMessage(chatId, 'Нет операций.');

  const lines = data.map((op: any) => {
    const sign = op.type === 'expense' ? '-' : '+';
    const desc = op.description ? ` ${op.description}` : '';
    return `${op.operation_date} ${sign}${formatMoney(Number(op.amount))}${desc}`;
  });

  await sendMessage(chatId, `<b>Последние операции:</b>\n${lines.join('\n')}`);
}

// --- Main Handler ---

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 });
  }

  try {
    const update = await req.json();
    const message = update.message;
    if (!message?.text || !message?.from) {
      return new Response('OK', { status: 200 });
    }

    const chatId = message.chat.id;
    const telegramId = message.from.id;
    const text = message.text.trim();
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase().replace(/@\w+$/, ''); // strip @botname
    const args = parts.slice(1);

    // Commands that don't require linking
    if (command === '/start') {
      await handleStart(chatId);
      return new Response('OK', { status: 200 });
    }

    if (command === '/link') {
      await handleLink(chatId, telegramId, args);
      return new Response('OK', { status: 200 });
    }

    // All other commands require linked account
    const tgUser = await getTelegramUser(telegramId);
    if (!tgUser) {
      await sendMessage(chatId, 'Аккаунт не привязан. Используйте /link email password');
      return new Response('OK', { status: 200 });
    }

    const userId = tgUser.user_id;

    if (command === '/unlink') {
      await handleUnlink(chatId, telegramId);
      return new Response('OK', { status: 200 });
    }

    if (command === '/workspaces') {
      await handleWorkspaces(chatId, userId);
      return new Response('OK', { status: 200 });
    }

    if (command === '/ws') {
      await handleSelectWorkspace(chatId, telegramId, userId, args);
      return new Response('OK', { status: 200 });
    }

    // Commands that require a workspace
    const workspaceId = tgUser.default_workspace_id;
    if (!workspaceId) {
      await sendMessage(chatId, 'Не выбрано пространство. Используйте /workspaces и /ws номер');
      return new Response('OK', { status: 200 });
    }

    switch (command) {
      case '/balance':
        await handleBalance(chatId, workspaceId);
        break;
      case '/today':
        await handleToday(chatId, workspaceId);
        break;
      case '/month':
        await handleMonth(chatId, workspaceId);
        break;
      case '/add':
        await handleAdd(chatId, userId, workspaceId, 'expense', args);
        break;
      case '/income':
        await handleAdd(chatId, userId, workspaceId, 'income', args);
        break;
      case '/categories':
        await handleCategories(chatId, workspaceId);
        break;
      case '/addcat':
        await handleAddCategory(chatId, userId, workspaceId, args);
        break;
      case '/tags':
        await handleTags(chatId, workspaceId);
        break;
      case '/addtag':
        await handleAddTag(chatId, userId, workspaceId, args);
        break;
      case '/recent':
        await handleRecent(chatId, workspaceId);
        break;
      default:
        await sendMessage(chatId, 'Неизвестная команда. Используйте /start для списка команд.');
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Telegram bot error:', err.message);
    return new Response('OK', { status: 200 });
  }
});
