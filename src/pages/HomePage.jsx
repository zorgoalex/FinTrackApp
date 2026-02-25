import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { usePermissions } from '../hooks/usePermissions'
import { useOperations } from '../hooks/useOperations'
import AddOperationModal from '../components/AddOperationModal'
import QuickButtonsSettings from '../components/QuickButtonsSettings'

export default function HomePage() {
  const { workspaceId, currentWorkspace, updateQuickButtons } = useWorkspace()
  const permissions = usePermissions()
  const { addOperation } = useOperations(workspaceId)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState('income')
  const [modalCategory, setModalCategory] = useState('')
  const [showQuickSettings, setShowQuickSettings] = useState(false)

  const quickButtons = currentWorkspace?.quick_buttons || []

  const openAddModal = (type, category) => {
    if (!permissions.canCreateOperations) return
    setModalType(type)
    setModalCategory(category || '')
    setIsModalOpen(true)
  }

  const closeModal = () => setIsModalOpen(false)

  const handleModalSave = async (payload) => {
    const result = await addOperation(payload)
    if (result) closeModal()
  }

  return (
    <div className="container mx-auto max-w-7xl p-4">
      {/* Шапка для десктопа, управляемая из Layout */}
      <header className="hidden lg:flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Главная</h1>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">Персональный</span>
          <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center">
            <span className="text-white text-sm font-medium">П</span>
          </div>
        </div>
      </header>

      {/* Быстрые кнопки */}
      {workspaceId && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => openAddModal('income')}
              disabled={!permissions.canCreateOperations}
              className="px-3 py-2 rounded-lg bg-green-50 text-green-700 border border-green-200 disabled:opacity-50 font-medium text-sm truncate"
            >
              ＋ Доход
            </button>
            <button
              onClick={() => openAddModal('expense')}
              disabled={!permissions.canCreateOperations}
              className="px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 disabled:opacity-50 font-medium text-sm truncate"
            >
              ＋ Расход
            </button>
            {quickButtons.map((btn, i) => (
              <button
                key={i}
                onClick={() => openAddModal(btn.type, btn.category)}
                disabled={!permissions.canCreateOperations}
                className="px-3 py-2 rounded-lg bg-gray-50 text-gray-700 border border-gray-200 disabled:opacity-50 font-medium text-sm truncate hover:bg-gray-100"
              >
                ＋ {btn.label}
              </button>
            ))}
            {permissions.hasManagementRights && quickButtons.length < 5 && (
              <button
                onClick={() => setShowQuickSettings(true)}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-300 transition-colors"
              >
                <Plus size={16} />
              </button>
            )}
          </div>
          {!permissions.canCreateOperations && (
            <p className="text-xs text-gray-500 mt-2">У вас нет прав на добавление операций.</p>
          )}
        </div>
      )}

      {/* Виджеты аналитики */}
      <main className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      <button className="fab" title="Добавить операцию">
        <Plus size={24} />
      </button>

      {isModalOpen && (
        <AddOperationModal
          type={modalType}
          defaultCategory={modalCategory}
          workspaceId={workspaceId}
          onClose={closeModal}
          onSave={handleModalSave}
        />
      )}

      {showQuickSettings && (
        <QuickButtonsSettings
          workspaceId={workspaceId}
          buttons={quickButtons}
          onSave={updateQuickButtons}
          onClose={() => setShowQuickSettings(false)}
        />
      )}
    </div>
  )
}
