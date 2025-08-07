import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../contexts/AuthContext'; // Assuming supabase is exported from AuthContext
import { CheckCircle, XCircle, Loader } from 'lucide-react';

export default function InvitationAcceptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setError('Токен приглашения не найден в URL.');
      setLoading(false);
      return;
    }

    const acceptInvitation = async () => {
      try {
        const { data, error: functionError } = await supabase.functions.invoke('accept-invitation', {
          body: { token },
        });

        if (functionError) {
          const errorMessage = functionError.context?.errorMessage || 'Не удалось принять приглашение.';
          throw new Error(errorMessage);
        }

        setSuccess(true);

        // Redirect to the new workspace after a short delay
        setTimeout(() => {
          navigate(`/workspace/${data.workspaceId}`);
        }, 3000);

      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    acceptInvitation();
  }, [searchParams, navigate]);

  const renderContent = () => {
    if (loading) {
      return (
        <>
          <Loader className="animate-spin h-12 w-12 text-blue-600" />
          <h1 className="mt-4 text-2xl font-bold text-gray-800">Принимаем приглашение...</h1>
          <p className="text-gray-600">Пожалуйста, подождите.</p>
        </>
      );
    }

    if (error) {
      return (
        <>
          <XCircle className="h-12 w-12 text-red-500" />
          <h1 className="mt-4 text-2xl font-bold text-gray-800">Ошибка</h1>
          <p className="text-red-600 bg-red-100 p-3 rounded-md">{error}</p>
          <button onClick={() => navigate('/')} className="mt-6 btn btn-primary">
            На главную
          </button>
        </>
      );
    }

    if (success) {
      return (
        <>
          <CheckCircle className="h-12 w-12 text-green-500" />
          <h1 className="mt-4 text-2xl font-bold text-gray-800">Приглашение принято!</h1>
          <p className="text-gray-600">Вы успешно присоединились к рабочему пространству.</p>
          <p className="text-gray-600">Перенаправляем вас...</p>
        </>
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center p-8 bg-white shadow-lg rounded-lg max-w-md w-full">
        {renderContent()}
      </div>
    </div>
  );
}
