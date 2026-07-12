const RULES = [
  { names: ['Зарплаты сотрудникам'], words: /зарплат|аванс сотрудник|социальн.*отчислен/i },
  { names: ['Налоги и обязательные платежи', 'Налоги'], words: /налог|кбк|кнп|бюджет/i },
  { names: ['Транспорт и доставка', 'Транспорт'], words: /азс|топлив|такси|парков|достав|oil/i },
  { names: ['ПО и подписки'], words: /software|subscription|cloud|облач|krea|openai|google|microsoft/i },
  { names: ['Маркетинг и реклама'], words: /реклам|marketing|facebook|instagram/i },
  { names: ['Закупки и себестоимость', 'Покупки'], words: /товар|закуп|материал|магазин|market|продукт|супермаркет|magnum/i },
  { names: ['Банковские комиссии'], words: /комисси|обслуживан.*сч[её]т/i },
  { names: ['Услуги', 'Продажи'], words: /поступлен|оплата.*клиент|продаж/i, type: 'income' },
  { names: ['Прочие доходы'], words: /пополнен|возврат/i, type: 'income' },
  { names: ['Прочие расходы'], words: /снятие|перевод|плат[её]ж/i, type: 'expense' },
];

export function normalizeRuleText(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^a-zа-яё0-9]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildRulePattern(operation) {
  const value = normalizeRuleText(operation.description || operation.source_label)
    .replace(/^(покупка|оплата|платеж|платёж|перевод|поступление|пополнение|списание)\s+/u, '')
    .replace(/\b(kzt|rub|usd|eur)\b/giu, '')
    .replace(/\b\d+[.,]?\d*\b/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length >= 3 ? value.slice(0, 120) : '';
}

export function suggestCategory(operation, categories, categoryRules = []) {
  const description = `${operation.source_label || ''} ${operation.description || ''}`;
  const normalizedDescription = normalizeRuleText(description);
  const expectedCategoryType = ['income', 'personal_salary'].includes(operation.type) ? 'income' : 'expense';

  const learnedRules = [...categoryRules]
    .filter((rule) => rule.is_active !== false && rule.operation_type === operation.type)
    .sort((a, b) => (a.priority || 100) - (b.priority || 100));
  for (const rule of learnedRules) {
    if (!normalizedDescription.includes(normalizeRuleText(rule.pattern))) continue;
    const category = categories.find((item) => item.id === rule.category_id
      && !item.is_archived
      && item.type === expectedCategoryType);
    if (category) return category.id;
  }

  for (const rule of RULES) {
    if (rule.type && rule.type !== operation.type) continue;
    if (!rule.words.test(description)) continue;
    const match = rule.names
      .map((name) => categories.find((category) => !category.is_archived && category.type === expectedCategoryType && category.name === name))
      .find(Boolean);
    if (match) return match.id;
  }
  return '';
}
