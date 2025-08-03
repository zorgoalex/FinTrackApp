import { Plus, Home } from 'lucide-react'

export function HomePage() {
  return (
    <div className="container mx-auto max-w-md">
      {/* Шапка для десктопа */}
      <header className="bg-white shadow-sm border-b px-4 py-3 hidden lg:block">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">ФинУчёт</h1>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Персональный</span>
            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-medium">П</span>
            </div>
          </div>
        </div>
      </header>

      {/* Виджеты аналитики */}
      <main className="p-4 space-y-4">
        <div className="grid grid-cols-1 gap-4">
          {/* За сегодня */}
          <div className="card">
            <h2 className="text-lg font-medium text-gray-900 mb-3">За сегодня</h2>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Поступления</span>
                <span className="font-medium text-green-600">+25 000</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Расходы</span>
                <span className="font-medium text-red-600">-15 000</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Зарплаты</span>
                <span className="font-medium text-blue-600">-5 000</span>
              </div>
              <hr className="my-2" />
              <div className="flex justify-between font-semibold">
                <span>Итого</span>
                <span className="text-green-600">+5 000</span>
              </div>
            </div>
          </div>

          {/* За месяц */}
          <div className="card">
            <h2 className="text-lg font-medium text-gray-900 mb-3">За месяц</h2>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Поступления</span>
                <span className="font-medium text-green-600">+850 000</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Расходы</span>
                <span className="font-medium text-red-600">-420 000</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Зарплаты</span>
                <span className="font-medium text-blue-600">-180 000</span>
              </div>
              <hr className="my-2" />
              <div className="flex justify-between font-semibold">
                <span>Итого</span>
                <span className="text-green-600">+250 000</span>
              </div>
            </div>
          </div>
        </div>

        {/* Недавние операции */}
        <div className="card">
          <h2 className="text-lg font-medium text-gray-900 mb-3">Последние операции</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium">Поступление от клиента</div>
                <div className="text-sm text-gray-500">Проект А • Филиал 1</div>
              </div>
              <span className="font-medium text-green-600">+50 000</span>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium">Зарплата Иванов И.И.</div>
                <div className="text-sm text-gray-500">Разработка • Филиал 1</div>
              </div>
              <span className="font-medium text-blue-600">-25 000</span>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium">Офисная мебель</div>
                <div className="text-sm text-gray-500">ООО Поставщик • Филиал 1</div>
              </div>
              <span className="font-medium text-red-600">-15 000</span>
            </div>
          </div>
        </div>
      </main>

      {/* FAB кнопка */}
      <button className="fab">
        <Plus size={24} />
      </button>

      {/* Кнопка домой (всегда видна) */}
      <button className="fixed bottom-6 left-6 w-12 h-12 bg-gray-600 hover:bg-gray-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 z-50">
        <Home size={20} />
      </button>
    </div>
  )
}
