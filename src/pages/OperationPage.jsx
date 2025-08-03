import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const operationTypes = [
  { id: 'income', name: 'Поступления' },
  { id: 'expense', name: 'Расходы' },
  { id: 'salary', name: 'Зарплата' },
]

export function OperationPage() {
  const [operationType, setOperationType] = useState('income')
  const navigate = useNavigate()

  const handleSave = () => {
    // TODO: Implement save logic
    navigate('/')
  }

  return (
    <div className="container mx-auto max-w-md p-4">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Новая операция</h1>
        <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">
          Закрыть
        </button>
      </header>

      <div className="space-y-6">
        {/* Тип операции */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Тип операции</label>
          <div className="flex space-x-2">
            {operationTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setOperationType(type.id)}
                className={`flex-1 py-2 px-4 rounded-lg transition-colors ${
                  operationType === type.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                }`}
              >
                {type.name}
              </button>
            ))}
          </div>
        </div>

        {/* Общие поля */}
        <div className="space-y-4">
          <div>
            <label htmlFor="date" className="block text-sm font-medium text-gray-700">Дата</label>
            <input id="date" type="date" className="input-field mt-1" defaultValue={new Date().toISOString().substring(0, 10)} />
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700">Сумма</label>
            <input id="amount" type="number" placeholder="0.00" className="input-field mt-1" />
          </div>
          <div>
            <label htmlFor="project" className="block text-sm font-medium text-gray-700">Проект</label>
            <select id="project" className="input-field mt-1">
              <option>Проект А</option>
              <option>Проект Б</option>
            </select>
          </div>
          <div>
            <label htmlFor="branch" className="block text-sm font-medium text-gray-700">Филиал</label>
            <select id="branch" className="input-field mt-1">
              <option>Филиал 1</option>
              <option>Филиал 2</option>
            </select>
          </div>
          <div>
            <label htmlFor="note" className="block text-sm font-medium text-gray-700">Примечание</label>
            <textarea id="note" rows="3" className="input-field mt-1" placeholder="Дополнительная информация"></textarea>
          </div>
        </div>

        {/* Дополнительные поля в зависимости от типа */}
        {operationType === 'salary' && (
          <div className="space-y-4 border-t pt-4">
            <h3 className="font-medium text-gray-900">Детали по зарплате</h3>
            <div>
              <label htmlFor="employee" className="block text-sm font-medium text-gray-700">Сотрудник</label>
              <select id="employee" className="input-field mt-1">
                <option>Иванов И.И.</option>
                <option>Петров П.П.</option>
              </select>
            </div>
            <div>
              <label htmlFor="task" className="block text-sm font-medium text-gray-700">Задача</label>
              <input id="task" type="text" placeholder="Название задачи" className="input-field mt-1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Статус</label>
              <select className="input-field mt-1">
                <option>выдано</option>
                <option>невыдано</option>
              </select>
            </div>
          </div>
        )}

        {operationType === 'income' && (
          <div className="space-y-4 border-t pt-4">
            <h3 className="font-medium text-gray-900">Детали по поступлению</h3>
            <div>
              <label htmlFor="source" className="block text-sm font-medium text-gray-700">Источник средств</label>
              <input id="source" type="text" placeholder="Название источника" className="input-field mt-1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Статус</label>
              <select className="input-field mt-1">
                <option>поступило</option>
                <option>не поступило</option>
              </select>
            </div>
          </div>
        )}

        {operationType === 'expense' && (
          <div className="space-y-4 border-t pt-4">
            <h3 className="font-medium text-gray-900">Детали по расходу</h3>
            <div>
              <label htmlFor="service" className="block text-sm font-medium text-gray-700">Услуга</label>
              <input id="service" type="text" placeholder="Название услуги" className="input-field mt-1" />
            </div>
            <div>
              <label htmlFor="supplier" className="block text-sm font-medium text-gray-700">Поставщик</label>
              <input id="supplier" type="text" placeholder="Название поставщика" className="input-field mt-1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Статус</label>
              <select className="input-field mt-1">
                <option>оплачено</option>
                <option>в долг</option>
                <option>неоплачено</option>
              </select>
            </div>
          </div>
        )}

        {/* Кнопки */}
        <div className="flex justify-end space-x-4 pt-4 border-t">
          <button onClick={handleSave} className="btn-primary">
            Сохранить
          </button>
          <button onClick={() => navigate('/')} className="btn-secondary">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
