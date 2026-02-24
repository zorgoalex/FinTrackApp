/**
 * FinTrackApp Full Browser Test
 * Запуск: node test_browser.js
 */
const puppeteer = require('/tmp/node_modules/puppeteer-core');
const chromium = require('/tmp/node_modules/@sparticuz/chromium');

const SITE = 'https://fintrackapp-alexeys-projects-7afd0399.vercel.app';
const TEST_EMAIL = 'test@fintrack.app';
const TEST_PASS = 'Test1234!';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function sanitizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-zа-я0-9_\-]/gi, '')
    .slice(0, 60);
}

async function runTests() {
  const results = [];
  let stepNo = 0;

  const state = {
    createdWorkspaceName: `AutoTest WS ${Date.now()}`,
    createdWorkspaceId: null,
    currentWorkspaceId: null,
    incomeDescription: `AUTO_INCOME_${Date.now()}`,
    expenseDescription: `AUTO_EXPENSE_${Date.now()}`,
  };

  const log = (name, ok, detail = '') => {
    results.push({ test: name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const screenshotStep = async (page, name) => {
    stepNo += 1;
    const path = `/tmp/test_${String(stepNo).padStart(3, '0')}_${sanitizeName(name)}.png`;
    try {
      await page.screenshot({ path, fullPage: true });
      console.log(`📸 ${path}`);
    } catch (e) {
      console.log(`❌ Скриншот не сохранен: ${e.message}`);
    }
  };

  const toDetail = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value.detail) return value.detail;
    return String(value);
  };

  const runStep = async (page, name, fn) => {
    let ok = false;
    let detail = '';
    try {
      const result = await fn();
      if (typeof result === 'boolean') {
        ok = result;
      } else if (typeof result === 'object' && result !== null) {
        ok = result.ok !== false;
        detail = toDetail(result);
      } else if (typeof result === 'string') {
        ok = true;
        detail = result;
      } else {
        ok = true;
      }
    } catch (e) {
      ok = false;
      detail = e?.message ? e.message.slice(0, 250) : 'Неизвестная ошибка';
    }

    log(name, ok, detail);
    await screenshotStep(page, name);
  };

  const clickByText = async (page, regexSource, selectors = 'button, a, [role="button"], [role="menuitem"]') => {
    return page.evaluate(
      ({ regexSource, selectors }) => {
        const rx = new RegExp(regexSource, 'i');
        const elements = Array.from(document.querySelectorAll(selectors));
        const visible = elements.filter((el) => {
          const style = window.getComputedStyle(el);
          return style && style.visibility !== 'hidden' && style.display !== 'none';
        });
        const target = visible.find((el) => rx.test((el.innerText || el.textContent || '').trim()));
        if (!target) return false;
        target.click();
        return true;
      },
      { regexSource, selectors }
    );
  };

  const typeInFirst = async (page, selectors, text) => {
    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el) {
        await el.click({ clickCount: 3 });
        await page.keyboard.press('Backspace').catch(() => {});
        await el.type(String(text), { delay: 20 });
        return selector;
      }
    }
    return null;
  };

  const parseWorkspaceId = (url) => {
    const m = String(url).match(/\/workspace\/([^/?#]+)/);
    return m ? m[1] : null;
  };

  const ensureWorkspacePage = async (page) => {
    let url = page.url();
    if (url.includes('/workspace/')) {
      state.currentWorkspaceId = parseWorkspaceId(url);
      return { ok: true, detail: `URL: ${url}` };
    }

    if (url.includes('/workspaces')) {
      const clickedPersonal = await clickByText(page, 'Personal|Личн|Персонал|пространств');
      if (!clickedPersonal) {
        const clickedAnyWorkspace = await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('button'));
          const target = candidates.find((btn) => /•/.test((btn.innerText || '').trim()));
          if (!target) return false;
          target.click();
          return true;
        });
        if (!clickedAnyWorkspace) {
          return { ok: false, detail: 'Не найдено рабочее пространство для входа' };
        }
      }

      await wait(2500);
      url = page.url();
      const ok = url.includes('/workspace/');
      if (ok) state.currentWorkspaceId = parseWorkspaceId(url);
      return { ok, detail: `URL: ${url}` };
    }

    return { ok: false, detail: `Ожидалась страница workspace, текущий URL: ${url}` };
  };

  const createOperation = async (page, kind, amount, description) => {
    const openQuickAction = await clickByText(page, kind === 'income' ? 'Доход|Поступлен' : 'Расход');
    await wait(1200);

    if (!openQuickAction) {
      return { ok: false, detail: `Кнопка быстрого действия ${kind} не найдена` };
    }

    if (page.url().includes('/operations')) {
      if (kind === 'income') await clickByText(page, 'Поступления|Доход');
      if (kind === 'expense') await clickByText(page, 'Расходы|Расход');
      await wait(300);
    }

    const amountSelector = await typeInFirst(page, [
      '#amount',
      'input[name="amount"]',
      'input[name*="amount" i]',
      'input[placeholder*="Сум" i]',
      'input[type="number"]',
    ], amount);

    const descSelector = await typeInFirst(page, [
      'textarea[name="description"]',
      'textarea[name*="note" i]',
      '#note',
      'textarea',
      'input[name*="description" i]',
      'input[placeholder*="Опис" i]',
      'input[placeholder*="Примеч" i]',
      'input[type="text"]',
    ], description);

    const saved = await clickByText(page, 'Сохранить|Добавить|Создать|Save');
    await wait(1800);

    if (!amountSelector) {
      return { ok: false, detail: 'Поле суммы не найдено' };
    }

    if (!saved) {
      return {
        ok: false,
        detail: `Форма открылась (${amountSelector}${descSelector ? `, ${descSelector}` : ''}), но кнопка сохранения не найдена`,
      };
    }

    return {
      ok: true,
      detail: `Заполнено: ${amountSelector}${descSelector ? `, ${descSelector}` : ''}`,
    };
  };

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    defaultViewport: { width: 1440, height: 900 },
    headless: true,
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  page.on('dialog', async (dialog) => {
    try {
      const type = dialog.type();
      const message = dialog.message().slice(0, 120);
      console.log(`ℹ️ Dialog ${type}: ${message}`);
      if (type === 'prompt') {
        await dialog.accept(state.createdWorkspaceName);
      } else {
        await dialog.accept();
      }
    } catch (e) {
      console.log(`❌ Ошибка обработки dialog: ${e.message}`);
    }
  });

  try {
    await runStep(page, '1_открыть_сайт', async () => {
      const res = await page.goto(SITE, { waitUntil: 'networkidle2', timeout: 30000 });
      const status = res ? res.status() : 0;
      return {
        ok: !!res && status >= 200 && status < 400,
        detail: `HTTP ${status}, URL: ${page.url()}`,
      };
    });

    await runStep(page, '2_войти_под_тестовым_пользователем', async () => {
      const emailInput = await page.$('input[type="email"]');
      const passInput = await page.$('input[type="password"]');

      if (!emailInput || !passInput) {
        return { ok: false, detail: 'Поля логина/пароля не найдены' };
      }

      await emailInput.click({ clickCount: 3 });
      await emailInput.type(TEST_EMAIL, { delay: 20 });
      await passInput.click({ clickCount: 3 });
      await passInput.type(TEST_PASS, { delay: 20 });

      const clicked = await clickByText(page, '^Войти$|Войти|Sign in');
      if (!clicked) {
        const submit = await page.$('button[type="submit"]');
        if (submit) await submit.click();
      }

      await page.waitForFunction(
        () => !window.location.pathname.includes('/login'),
        { timeout: 20000 }
      ).catch(() => {});

      const url = page.url();
      const ok = !url.includes('/login');
      return { ok, detail: `URL после входа: ${url}` };
    });

    await runStep(page, '3_создать_новое_workspace_через_dropdown', async () => {
      const ensured = await ensureWorkspacePage(page);
      if (!ensured.ok) return ensured;

      const opened = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const target = buttons.find((btn) => {
          const text = (btn.innerText || '').trim();
          return /Владелец|Администратор|Участник|Наблюдатель|Personal|Личное|Персонал/.test(text);
        });
        if (!target) return false;
        target.click();
        return true;
      });

      if (!opened) {
        return { ok: false, detail: 'Не удалось открыть dropdown workspace' };
      }

      await wait(600);

      const clickCreate = await clickByText(page, 'Создать новое пространство|Создать.*пространств|Create');
      if (!clickCreate) {
        return { ok: false, detail: 'Пункт создания workspace в dropdown не найден' };
      }

      await page.waitForFunction(
        () => window.location.pathname.includes('/workspaces/create'),
        { timeout: 10000 }
      ).catch(() => {});

      const nameInput = await page.$('input[name="name"], input#name, input[type="text"]');
      if (!nameInput) {
        return { ok: false, detail: 'Форма создания workspace не найдена' };
      }

      await nameInput.click({ clickCount: 3 });
      await nameInput.type(state.createdWorkspaceName, { delay: 20 });

      const submit = await clickByText(page, 'Создать пространство|Создать$');
      if (!submit) {
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) await submitBtn.click();
      }

      await page.waitForFunction(
        () => window.location.pathname.includes('/workspace/'),
        { timeout: 20000 }
      ).catch(() => {});

      const url = page.url();
      const workspaceId = parseWorkspaceId(url);
      state.createdWorkspaceId = workspaceId;
      state.currentWorkspaceId = workspaceId;

      const ok = !!workspaceId;
      return { ok, detail: `Создано: ${state.createdWorkspaceName}, workspaceId: ${workspaceId || 'нет'}` };
    });

    await runStep(page, '4_создать_запись_доход', async () => {
      const ensured = await ensureWorkspacePage(page);
      if (!ensured.ok) return ensured;
      return createOperation(page, 'income', '12345', state.incomeDescription);
    });

    await runStep(page, '5_создать_запись_расход', async () => {
      const ensured = await ensureWorkspacePage(page);
      if (!ensured.ok) return ensured;
      return createOperation(page, 'expense', '678', state.expenseDescription);
    });

    await runStep(page, '6_проверить_что_записи_есть_в_списке', async () => {
      await wait(1200);
      const text = await page.evaluate(() => document.body.innerText || '');
      const hasIncome = text.includes(state.incomeDescription);
      const hasExpense = text.includes(state.expenseDescription);
      return {
        ok: hasIncome && hasExpense,
        detail: `income=${hasIncome}, expense=${hasExpense}`,
      };
    });

    await runStep(page, '7_удалить_одну_запись', async () => {
      const deleted = await page.evaluate((expenseDescription) => {
        const textNodes = Array.from(document.querySelectorAll('*')).filter((el) => {
          const t = (el.textContent || '').trim();
          return t && t.includes(expenseDescription) && el.children.length < 5;
        });

        for (const node of textNodes) {
          let container = node;
          for (let i = 0; i < 6 && container; i += 1) {
            const btn = container.querySelector('button[title*="Удал" i], button[aria-label*="Удал" i], button[title*="Delete" i], button[aria-label*="Delete" i], button[class*="delete" i]');
            if (btn) {
              btn.click();
              return true;
            }
            container = container.parentElement;
          }
        }

        const fallback = Array.from(document.querySelectorAll('button')).find((btn) => {
          const t = (btn.innerText || btn.textContent || '').trim();
          return /Удалить|Delete|Remove/.test(t);
        });

        if (fallback) {
          fallback.click();
          return true;
        }

        return false;
      }, state.expenseDescription);

      await wait(1200);
      return {
        ok: deleted,
        detail: deleted ? 'Нажата кнопка удаления записи' : 'Кнопка удаления записи не найдена',
      };
    });

    await runStep(page, '8_переключиться_между_workspace', async () => {
      const ensured = await ensureWorkspacePage(page);
      if (!ensured.ok) return ensured;

      const openDropdown = async () => {
        const opened = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const target = buttons.find((btn) => {
            const text = (btn.innerText || '').trim();
            return /Владелец|Администратор|Участник|Наблюдатель|Personal|Личное|Персонал/.test(text);
          });
          if (!target) return false;
          target.click();
          return true;
        });
        await wait(500);
        return opened;
      };

      let switchedPersonal = false;
      if (await openDropdown()) {
        switchedPersonal = await clickByText(page, 'Personal|Личное|Персонал');
      }

      if (switchedPersonal) await wait(1600);

      let switchedBack = false;
      if (await openDropdown()) {
        const escaped = state.createdWorkspaceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        switchedBack = await clickByText(page, escaped);
      }

      if (switchedBack) await wait(1600);

      const finalUrl = page.url();
      state.currentWorkspaceId = parseWorkspaceId(finalUrl) || state.currentWorkspaceId;

      const ok = switchedPersonal && switchedBack;
      return {
        ok,
        detail: `switch Personal=${switchedPersonal}, back=${switchedBack}, URL=${finalUrl}`,
      };
    });

    await runStep(page, '9_удалить_созданный_workspace_если_возможно', async () => {
      if (!state.createdWorkspaceId) {
        return { ok: false, detail: 'ID созданного workspace не найден' };
      }

      await page.goto(`${SITE}/workspace/${state.createdWorkspaceId}/settings`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      const hasSettingsHeader = await page.evaluate(() => {
        const t = document.body.innerText || '';
        return /Настройки рабочего пространства|Опасная зона/.test(t);
      });

      if (!hasSettingsHeader) {
        return { ok: false, detail: 'Страница настроек workspace не открылась' };
      }

      const hasDeleteBtn = await clickByText(page, 'Удалить пространство');
      if (!hasDeleteBtn) {
        return { ok: true, detail: 'Кнопка удаления отсутствует в UI, шаг пропущен' };
      }

      await wait(2500);

      const onWorkspaces = page.url().includes('/workspaces');
      const body = await page.evaluate(() => document.body.innerText || '');
      const stillListed = body.includes(state.createdWorkspaceName);

      return {
        ok: onWorkspaces || !stillListed,
        detail: `URL=${page.url()}, stillListed=${stillListed}`,
      };
    });

    await runStep(page, '10_проверить_раздел_детали_и_статистика', async () => {
      if (!state.currentWorkspaceId) {
        const ensured = await ensureWorkspacePage(page);
        if (!ensured.ok) return ensured;
      }

      if (!page.url().includes('/workspace/')) {
        const fallbackId = state.currentWorkspaceId || state.createdWorkspaceId;
        if (fallbackId) {
          await page.goto(`${SITE}/workspace/${fallbackId}`, { waitUntil: 'networkidle2', timeout: 30000 });
        }
      }

      const check = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const hasToday = /За сегодня/.test(text);
        const hasMonth = /За месяц/.test(text);
        const detailButtons = Array.from(document.querySelectorAll('button')).filter((btn) => /Детали/i.test(btn.innerText || ''));
        if (detailButtons[0]) detailButtons[0].click();
        return { hasToday, hasMonth, detailBtnCount: detailButtons.length };
      });

      return {
        ok: check.hasToday && check.hasMonth,
        detail: `today=${check.hasToday}, month=${check.hasMonth}, detailButtons=${check.detailBtnCount}`,
      };
    });

    await runStep(page, '11_проверить_профиль_и_настройки_пользователя', async () => {
      const userCheck = await page.evaluate((email) => {
        const text = document.body.innerText || '';
        const hasEmail = text.includes(email);

        const logoutBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
          const t = (el.innerText || el.textContent || '').trim();
          const title = el.getAttribute('title') || '';
          return /Выйти|Logout|Sign out/.test(t) || /Выйти|Logout|Sign out/.test(title);
        });

        return {
          hasEmail,
          hasLogoutControl: !!logoutBtn,
        };
      }, TEST_EMAIL);

      return {
        ok: userCheck.hasEmail && userCheck.hasLogoutControl,
        detail: `email=${userCheck.hasEmail}, logoutControl=${userCheck.hasLogoutControl}`,
      };
    });
  } catch (fatalError) {
    log('Фатальная_ошибка_раннера', false, fatalError.message || String(fatalError));
    await screenshotStep(page, 'fatal_error');
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n=== Итог: ${passed}/${total} прошло ===`);
}

runTests().catch((e) => {
  console.error('Фатальная ошибка запуска:', e);
});
