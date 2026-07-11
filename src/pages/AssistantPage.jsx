import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Send, ShieldCheck, Sparkles, User } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';

function dateString(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

const SUGGESTIONS = [
  'На что ушло больше всего денег?',
  'Сравни доходы и расходы и дай краткий вывод',
  'Какие категории расходов требуют внимания?',
  'Хватит ли текущего денежного потока при таком темпе?',
];

export default function AssistantPage() {
  const [searchParams] = useSearchParams();
  const { workspaceId: contextWorkspaceId, userRole } = useWorkspace();
  const workspaceId = searchParams.get('workspaceId') || contextWorkspaceId;
  const today = useMemo(() => new Date(), []);
  const [dateFrom, setDateFrom] = useState(() => dateString(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(() => dateString(today));
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ask = async (text = question) => {
    const cleanQuestion = text.trim();
    if (!cleanQuestion || !workspaceId || loading) return;
    setMessages((current) => [...current, { role: 'user', text: cleanQuestion }]);
    setQuestion('');
    setError('');
    setLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ai-assistant', {
        body: { workspaceId, question: cleanQuestion, dateFrom, dateTo },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setMessages((current) => [...current, {
        role: 'assistant',
        text: data?.answer || 'Ответ не получен',
        meta: data?.mode === 'provider' ? data.model : 'локальная сводка',
      }]);
    } catch (askError) {
      setError(askError.message || 'Не удалось получить ответ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col p-4 pb-24 sm:p-6 lg:min-h-screen lg:pb-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"><Sparkles size={21} /></div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">AI-ассистент</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">Аналитика бюджета на естественном языке</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          <ShieldCheck size={16} /> Только чтение · роль {userRole || '—'}
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:flex sm:items-end">
        <label className="text-xs text-gray-600 dark:text-gray-400">С даты
          <input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} className="input-field mt-1 min-h-11 w-full" />
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">По дату
          <input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} className="input-field mt-1 min-h-11 w-full" />
        </label>
        <p className="col-span-2 text-xs text-gray-500 dark:text-gray-400 sm:ml-auto sm:max-w-sm">Ассистент получает только разрешённую для вашей роли сводку за период, а не прямой доступ к SQL.</p>
      </div>

      <div className="flex-1 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="max-h-[55vh] min-h-72 space-y-4 overflow-y-auto p-4 sm:p-5">
          {messages.length === 0 && (
            <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
              <Bot size={38} className="mb-3 text-primary-500" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Что хотите узнать о финансах?</h2>
              <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">Выберите готовый вопрос или сформулируйте свой. Ответ не изменяет данные.</p>
              <div className="mt-4 flex max-w-2xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => ask(suggestion)} className="min-h-11 rounded-xl border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 hover:border-primary-300 hover:bg-primary-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-primary-900/20">{suggestion}</button>)}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>
              {message.role === 'assistant' && <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"><Bot size={18} /></div>}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}>
                <p className="whitespace-pre-wrap">{message.text}</p>
                {message.meta && <p className="mt-2 text-[10px] opacity-60">{message.meta}</p>}
              </div>
              {message.role === 'user' && <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"><User size={18} /></div>}
            </div>
          ))}
          {loading && <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-primary-100 text-primary-700"><Bot size={18} /></div><div className="rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-300">Анализирую разрешённые данные…</div></div>}
        </div>

        <form onSubmit={(event) => { event.preventDefault(); ask(); }} className="border-t border-gray-200 p-3 dark:border-gray-700 sm:p-4">
          {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea value={question} onChange={(event) => setQuestion(event.target.value.slice(0, 1000))} rows="2" placeholder="Например: почему расходы выросли?" className="input-field min-h-12 flex-1 resize-none" aria-label="Вопрос ассистенту" />
            <button type="submit" disabled={loading || !question.trim()} className="btn-primary grid min-h-12 min-w-12 place-items-center p-2 disabled:opacity-50" aria-label="Отправить вопрос"><Send size={19} /></button>
          </div>
        </form>
      </div>
    </div>
  );
}
