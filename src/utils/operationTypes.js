export const OPERATION_TYPE_META = {
  income: { label: 'Доход', direction: 'income', sign: '+' },
  personal_salary: { label: 'Личная зарплата', direction: 'income', sign: '+' },
  expense: { label: 'Расход', direction: 'expense', sign: '−' },
  employee_salary: { label: 'Зарплата сотрудникам', direction: 'expense', sign: '−' },
  transfer: { label: 'Перевод', direction: 'transfer', sign: '⇄' },
};

export const operationDirection = (type) => OPERATION_TYPE_META[type]?.direction || type;
export const isIncomeType = (type) => operationDirection(type) === 'income';
export const isExpenseType = (type) => operationDirection(type) === 'expense';
export const categoryTypeForOperation = (type) => isIncomeType(type) ? 'income' : 'expense';

export const operationTypesForWorkspace = (workspaceType) => workspaceType === 'personal'
  ? ['income', 'personal_salary', 'expense', 'transfer']
  : ['income', 'expense', 'employee_salary', 'transfer'];
