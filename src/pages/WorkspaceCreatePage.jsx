import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../contexts/AuthContext';
import { ArrowLeft, Building2, Check, Home, Users } from 'lucide-react';

const MODES = [
  {
    value: 'business',
    title: 'Бизнес',
    description: 'Денежный контроль микробизнеса: продажи, закупки, налоги и зарплаты сотрудникам.',
    icon: Building2,
  },
  {
    value: 'personal',
    title: 'Личное / семейное',
    description: 'Семейный бюджет: личная зарплата, жильё, продукты, здоровье и накопления.',
    icon: Home,
  },
];

export default function WorkspaceCreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [workspaceType, setWorkspaceType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim() || !workspaceType) {
      setError('Укажите название и выберите тип пространства');
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: createError } = await supabase.rpc('create_workspace', {
      p_name: name.trim(),
      p_workspace_type: workspaceType,
    });
    setLoading(false);
    if (createError) {
      setError(createError.message || 'Не удалось создать пространство');
      return;
    }
    navigate(`/workspace/${data}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6 sm:py-10">
      <main className="mx-auto max-w-3xl">
        <button onClick={() => navigate(-1)} className="mb-5 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
          <ArrowLeft size={17} /> Назад
        </button>
        <div className="card p-5 sm:p-8">
          <div className="mb-7">
            <p className="mb-2 text-sm font-semibold text-primary-600 dark:text-primary-400">Новое пространство</p>
            <h1 className="text-2xl font-bold text-gray-950 dark:text-white sm:text-3xl">Как вы будете вести деньги?</h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Тип определяет стартовые категории и доступные финансовые сценарии.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Тип пространства *</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {MODES.map(({ value, title, description, icon: Icon }) => {
                  const selected = workspaceType === value;
                  return (
                    <button key={value} type="button" onClick={() => setWorkspaceType(value)}
                      className={`relative min-h-40 rounded-2xl border-2 p-5 text-left transition ${selected ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30' : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'}`}>
                      <div className="mb-4 flex items-center justify-between">
                        <span className={`rounded-xl p-2.5 ${selected ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}><Icon size={22} /></span>
                        {selected && <span className="rounded-full bg-primary-600 p-1 text-white"><Check size={14} /></span>}
                      </div>
                      <span className="block font-semibold text-gray-950 dark:text-white">{title}</span>
                      <span className="mt-1.5 block text-sm leading-5 text-gray-600 dark:text-gray-400">{description}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div>
              <label htmlFor="workspace-name" className="mb-2 block text-sm font-semibold text-gray-900 dark:text-gray-100">Название *</label>
              <input id="workspace-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)}
                placeholder={workspaceType === 'business' ? 'Например: Кофейня «Маяк»' : 'Например: Семья Ивановых'} maxLength={120} />
            </div>

            <div className="flex gap-3 rounded-xl bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
              <Users size={19} className="mt-0.5 shrink-0 text-primary-600" />
              <p>Вы станете владельцем. Участников и роли можно добавить позже.</p>
            </div>
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
            <button type="submit" disabled={loading || !name.trim() || !workspaceType} className="btn-primary min-h-12 w-full disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? 'Создаём…' : 'Создать пространство'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
