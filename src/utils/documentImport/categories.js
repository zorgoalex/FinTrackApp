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

export function suggestCategory(operation, categories) {
  const description = `${operation.source_label || ''} ${operation.description || ''}`;
  for (const rule of RULES) {
    if (rule.type && rule.type !== operation.type) continue;
    if (!rule.words.test(description)) continue;
    const match = rule.names
      .map((name) => categories.find((category) => !category.is_archived && category.type === operation.type && category.name === name))
      .find(Boolean);
    if (match) return match.id;
  }
  return '';
}
