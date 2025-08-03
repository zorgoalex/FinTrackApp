import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, supabase } from '../contexts/AuthContext';
import { ArrowLeft, Building2, Check } from 'lucide-react';

export default function WorkspaceCreatePage() {
  const [formData, setFormData] = useState({
    name: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      setError('Название рабочего пространства обязательно');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Создаем workspace
      const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .insert({
          name: formData.name.trim(),
          owner_id: user.id,
          is_personal: false
        })
        .select()
        .single();

      if (workspaceError) throw workspaceError;

      // 2. Добавляем создателя как owner в workspace_members
      const { error: memberError } = await supabase
        .from('workspace_members')
        .insert({
          workspace_id: workspace.id,
          user_id: user.id,
          role: 'Owner',
          is_active: true,
          joined_at: new Date().toISOString(),
          invited_at: new Date().toISOString()
        });

      if (memberError) throw memberError;

      // 3. Перенаправляем на новый workspace
      navigate(`/workspace/${workspace.id}`);
      
    } catch (err) {
      console.error('Error creating workspace:', err);
      setError(err.message || 'Ошибка при создании рабочего пространства');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        {/* Заголовок */}
        <div className="mb-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft size={16} className="mr-2" />
            Назад
          </button>
          
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Building2 size={24} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Создание рабочего пространства
              </h1>
              <p className="text-gray-600">
                Создайте новое пространство для совместной работы с командой
              </p>
            </div>
          </div>
        </div>

        {/* Форма */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Название */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Название пространства *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Например: Проект Alpha, Отдел маркетинга"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                disabled={loading}
              />
            </div>


            {/* Ошибка */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Информация */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
              <h3 className="text-sm font-medium text-blue-900 mb-2">
                Что произойдет после создания?
              </h3>
              <ul className="text-sm text-blue-700 space-y-1">
                <li className="flex items-start">
                  <Check size={14} className="mt-0.5 mr-2 flex-shrink-0" />
                  Вы станете владельцем пространства с полными правами
                </li>
                <li className="flex items-start">
                  <Check size={14} className="mt-0.5 mr-2 flex-shrink-0" />
                  Сможете приглашать участников и настраивать права доступа
                </li>
                <li className="flex items-start">
                  <Check size={14} className="mt-0.5 mr-2 flex-shrink-0" />
                  Пространство будет доступно только вам до приглашения других
                </li>
              </ul>
            </div>

            {/* Кнопки */}
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                disabled={loading}
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={loading || !formData.name.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Создание...
                  </>
                ) : (
                  <>
                    <Building2 size={16} className="mr-2" />
                    Создать пространство
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}