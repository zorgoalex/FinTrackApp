/**
 * Compute analytics from operations array.
 * @param {Array} operations - array of operation objects {type, amount, category_id, tags}
 * @param {Array} categories - array of category objects {id, name, type, color, is_archived}
 * @param {Array} tags - array of tag objects {id, name, color, is_archived}
 * @returns {Object} analytics data
 */
export function computeAnalytics(operations, categories = [], tags = []) {
  const totalIncome = operations
    .filter(op => op.type === 'income')
    .reduce((sum, op) => sum + Number(op.amount || 0), 0);

  const totalExpense = operations
    .filter(op => op.type === 'expense')
    .reduce((sum, op) => sum + Number(op.amount || 0), 0);

  const totalSalary = operations
    .filter(op => op.type === 'salary')
    .reduce((sum, op) => sum + Number(op.amount || 0), 0);

  const balance = totalIncome - totalExpense - totalSalary;

  // Category breakdown
  const categoryMap = new Map();
  operations.forEach(op => {
    if (!op.category_id) return;
    const existing = categoryMap.get(op.category_id) || { amount: 0, count: 0 };
    existing.amount += Number(op.amount || 0);
    existing.count += 1;
    categoryMap.set(op.category_id, existing);
  });

  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([catId, data]) => {
      const cat = categories.find(c => c.id === catId);
      return {
        categoryId: catId,
        name: cat?.name || 'Без названия',
        type: cat?.type || 'expense',
        color: cat?.color || '#6B7280',
        amount: data.amount,
        count: data.count,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // Tag breakdown
  const tagMap = new Map();
  operations.forEach(op => {
    (op.tags || []).forEach(t => {
      const existing = tagMap.get(t.id) || { amount: 0, count: 0 };
      existing.amount += Number(op.amount || 0);
      existing.count += 1;
      tagMap.set(t.id, existing);
    });
  });

  const tagBreakdown = Array.from(tagMap.entries())
    .map(([tagId, data]) => {
      const tag = tags.find(t => t.id === tagId);
      return {
        tagId,
        name: tag?.name || 'Без названия',
        color: tag?.color || '#6B7280',
        amount: data.amount,
        count: data.count,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    totalIncome,
    totalExpense,
    totalSalary,
    balance,
    operationCount: operations.length,
    categoryBreakdown,
    tagBreakdown,
  };
}
